import type { PixelBuffer, RGBA } from '../state';
import { applyOpacity } from './draw';
import type { BrushShape } from './types';

export type BrushType = 'pencil' | 'square' | 'circle' | 'custom' | 'pattern' | 'stamp' | 'texture' | 'scatter';

export interface BrushDefinition {
  id: string;
  name: string;
  type: BrushType;
  size: number;
  mask: number[];
  angle: number;
  spacing: number;
  density: number;
  opacity: number;
  scatter: number;
  randomRotation: boolean;
  randomSize: boolean;
  pressure: boolean;
}

export const MAX_BRUSH_LIBRARY_SIZE = 64;
const MAX_BRUSH_JSON_LENGTH = 256_000;
const TYPES = new Set<BrushType>(['pencil', 'square', 'circle', 'custom', 'pattern', 'stamp', 'texture', 'scatter']);

export function createBrushDefinition(
  name: string,
  size: number,
  shape: BrushShape = 'square',
  type: BrushType = shape === 'circle' ? 'circle' : 'square',
): BrushDefinition {
  const dimension = Math.max(1, Math.min(64, Math.round(size)));
  const center = (dimension - 1) / 2;
  const radiusSquared = (dimension / 2) ** 2;
  const mask = Array.from({ length: dimension * dimension }, (_, index) => {
    if (shape === 'square') return 1;
    const x = index % dimension;
    const y = Math.floor(index / dimension);
    return (x - center) ** 2 + (y - center) ** 2 <= radiusSquared ? 1 : 0;
  });
  return {
    id: `brush-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || `Brush ${dimension}`,
    type,
    size: dimension,
    mask,
    angle: 0,
    spacing: 1,
    density: 1,
    opacity: 100,
    scatter: type === 'scatter' ? Math.max(1, Math.round(dimension / 2)) : 0,
    randomRotation: false,
    randomSize: false,
    pressure: true,
  };
}

export function resizeBrushDefinition(brush: BrushDefinition, size: number): BrushDefinition {
  const dimension = Math.max(1, Math.min(64, Math.round(size)));
  if (dimension === brush.size) return brush;
  const mask = Array.from({ length: dimension * dimension }, (_, index) => {
    const x = index % dimension;
    const y = Math.floor(index / dimension);
    const sourceX = Math.min(brush.size - 1, Math.floor(((x + 0.5) / dimension) * brush.size));
    const sourceY = Math.min(brush.size - 1, Math.floor(((y + 0.5) / dimension) * brush.size));
    return brush.mask[sourceY * brush.size + sourceX];
  });
  return { ...brush, size: dimension, mask };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseBrushDefinition(value: unknown): BrushDefinition {
  if (!isRecord(value)) throw new TypeError('Brush data must be an object.');
  const size = value.size;
  const mask = value.mask;
  if (!Number.isInteger(size) || Number(size) < 1 || Number(size) > 64) {
    throw new RangeError('Brush size must be an integer from 1 to 64.');
  }
  if (!Array.isArray(mask) || mask.length !== Number(size) ** 2 || mask.some((pixel) => pixel !== 0 && pixel !== 1)) {
    throw new TypeError('Brush mask does not match its dimensions.');
  }
  if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 100) {
    throw new TypeError('Brush id is invalid.');
  }
  if (typeof value.name !== 'string' || value.name.trim().length === 0 || value.name.length > 80) {
    throw new TypeError('Brush name must contain 1 to 80 characters.');
  }
  if (typeof value.type !== 'string' || !TYPES.has(value.type as BrushType)) {
    throw new TypeError('Brush type is not supported.');
  }
  const numberFields = ['angle', 'spacing', 'density', 'opacity', 'scatter'] as const;
  for (const field of numberFields) {
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) {
      throw new TypeError(`Brush ${field} must be a finite number.`);
    }
  }
  const validRange = (field: typeof numberFields[number], min: number, max: number) =>
    Number(value[field]) >= min && Number(value[field]) <= max;
  if (
    !validRange('angle', -360, 360) ||
    !validRange('spacing', 1, 16) ||
    !validRange('density', 0, 1) ||
    !validRange('opacity', 0, 100) ||
    !validRange('scatter', 0, 64)
  ) {
    throw new RangeError('Brush settings are outside supported limits.');
  }
  for (const field of ['randomRotation', 'randomSize', 'pressure'] as const) {
    if (typeof value[field] !== 'boolean') throw new TypeError(`Brush ${field} must be boolean.`);
  }
  return {
    id: value.id,
    name: value.name.trim(),
    type: value.type as BrushType,
    size: Number(size),
    mask: [...mask] as number[],
    angle: Number(value.angle),
    spacing: Number(value.spacing),
    density: Number(value.density),
    opacity: Number(value.opacity),
    scatter: Number(value.scatter),
    randomRotation: value.randomRotation === true,
    randomSize: value.randomSize === true,
    pressure: value.pressure === true,
  };
}

export function parseBrushLibrary(text: string): BrushDefinition[] {
  if (text.length > MAX_BRUSH_JSON_LENGTH) throw new RangeError('Brush library file is too large.');
  const parsed: unknown = JSON.parse(text);
  if (
    !Array.isArray(parsed) &&
    isRecord(parsed) &&
    (parsed.format !== 'pixel-editor-brush-library' || parsed.version !== 1)
  ) {
    throw new TypeError('Brush library format or version is not supported.');
  }
  const items = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.brushes : null;
  if (!Array.isArray(items) || items.length > MAX_BRUSH_LIBRARY_SIZE) {
    throw new TypeError(`Brush library must contain at most ${MAX_BRUSH_LIBRARY_SIZE} brushes.`);
  }
  const brushes = items.map(parseBrushDefinition);
  if (new Set(brushes.map((brush) => brush.id)).size !== brushes.length) {
    throw new TypeError('Brush ids must be unique.');
  }
  return brushes;
}

export function serializeBrushLibrary(brushes: readonly BrushDefinition[]): string {
  if (brushes.length > MAX_BRUSH_LIBRARY_SIZE) {
    throw new RangeError(`Brush library must contain at most ${MAX_BRUSH_LIBRARY_SIZE} brushes.`);
  }
  return JSON.stringify({ format: 'pixel-editor-brush-library', version: 1, brushes }, null, 2);
}

function hash(x: number, y: number, salt: number): number {
  let value = Math.imul(x ^ salt, 0x45d9f3b) ^ Math.imul(y + salt, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000;
}

function drawStamp(
  x: number,
  y: number,
  brush: BrushDefinition,
  sizeScale: number,
  randomAngle: number,
  paintPixel: (x: number, y: number) => void,
): void {
  const size = Math.max(1, Math.round(brush.size * sizeScale));
  const radians = ((brush.angle + randomAngle) * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const half = (size - 1) / 2;
  const left = Math.trunc(x) - Math.floor(half);
  const top = Math.trunc(y) - Math.floor(half);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const sourceX = Math.floor(((px - half) * cosine + (py - half) * sine) * (brush.size / size) + (brush.size - 1) / 2);
      const sourceY = Math.floor((-(px - half) * sine + (py - half) * cosine) * (brush.size / size) + (brush.size - 1) / 2);
      if (sourceX < 0 || sourceY < 0 || sourceX >= brush.size || sourceY >= brush.size) continue;
      const sourceIndex = sourceY * brush.size + sourceX;
      if (brush.mask[sourceIndex] === 0 || hash(sourceX, sourceY, 1) > brush.density) continue;
      if (brush.type === 'pattern' && ((sourceX + sourceY) % 2 !== 0)) continue;
      if (brush.type === 'texture' && hash(sourceX, sourceY, 17) > brush.density * 0.75) continue;
      paintPixel(left + px, top + py);
    }
  }
}

/** Enumerates all covered pixels in a deterministic stamp, including scatter copies. */
export function forEachBrushPixel(
  x: number,
  y: number,
  brush: BrushDefinition,
  pressure = 1,
  visit: (x: number, y: number) => void,
): void {
  if (brush.density <= 0 || brush.opacity <= 0) return;
  const scale = brush.pressure ? Math.max(0.1, Math.min(1, pressure)) : 1;
  const seed = Math.floor(x * 65537 + y * 257);
  if (brush.type !== 'scatter') {
    drawStamp(
      x,
      y,
      brush,
      brush.randomSize ? scale * (0.75 + hash(x, y, seed) * 0.5) : scale,
      brush.randomRotation ? hash(x, y, seed + 1) * 360 : 0,
      visit,
    );
    return;
  }
  const count = Math.max(2, Math.min(16, Math.ceil(brush.spacing * 2)));
  for (let i = 0; i < count; i++) {
    const angle = hash(x, y, seed + i * 2) * Math.PI * 2;
    const distance = hash(x, y, seed + i * 2 + 1) * brush.scatter;
    drawStamp(
      Math.round(x + Math.cos(angle) * distance),
      Math.round(y + Math.sin(angle) * distance),
      brush,
      brush.randomSize ? scale * (0.75 + hash(x, y, seed + i) * 0.5) : scale,
      brush.randomRotation ? hash(x, y, seed + i + 1) * 360 : 0,
      visit,
    );
  }
}

/** Stamps all brush modes deterministically for the same path. */
export function stampBrushDefinition(
  buffer: PixelBuffer,
  x: number,
  y: number,
  color: RGBA,
  brush: BrushDefinition,
  opacity = 1,
  pressure = 1,
): void {
  if (opacity <= 0 || color.a === 0 || brush.density <= 0 || brush.opacity <= 0) return;
  const paint = applyOpacity(color, (opacity * brush.opacity) / 100);
  forEachBrushPixel(x, y, brush, pressure, (pixelX, pixelY) => buffer.setPixel(pixelX, pixelY, paint));
}
