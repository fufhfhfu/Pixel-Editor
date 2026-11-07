/**
 * Ядро: формат проекта (JSON). Им пользуются и файл проекта, и автосохранение.
 * Чистый TypeScript, без зависимости от Svelte и DOM.
 *
 * {
 *   "format": "pixel-editor-project", "version": 1, "savedAt": "…",
 *   "width": 32, "height": 32,
 *   "pixels": "<RGBA в base64>",
 *   "palette": { "id": "pico8", "freeColor": false },
 *   "colors": { "primary": [r, g, b, a], "secondary": [r, g, b, a] },
 *   "recent": [[r, g, b, a], …]
 * }
 */

import { DEFAULT_PALETTE_ID, MAX_RECENT_COLORS, PALETTES, getPalette, nearestPaletteColor } from './palette';
import { CHANNELS, isValidCanvasSize, normalizeTransparent, type RGBA } from './state';

export const PROJECT_FORMAT = 'pixel-editor-project';
export const PROJECT_VERSION = 2;
export const MAX_PROJECT_CANVASES = 32;
export const MAX_PROJECT_TOTAL_PIXELS = 4_194_304;
export const MAX_PROJECT_CANVAS_COORDINATE = 1_000_000;
/** Максимальный размер JSON проекта (символов), рассчитан на холст до 4 мегапикселей. */
export const MAX_PROJECT_JSON_LENGTH = 32 * 1024 * 1024;

export interface ProjectCanvasData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export interface ProjectData {
  width: number;
  height: number;
  /** RGBA, длина width × height × 4. */
  pixels: Uint8ClampedArray;
  paletteId: string;
  freeColor: boolean;
  primary: RGBA;
  secondary: RGBA;
  recent: RGBA[];
  notes?: string;
  canvases?: ProjectCanvasData[];
  activeCanvasId?: string;
}

/** Файл не является корректным проектом; message можно показывать пользователю. */
export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFormatError';
  }
}

export function bytesToBase64(bytes: Uint8ClampedArray): string {
  const CHUNK = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8ClampedArray {
  const binary = atob(text);
  const bytes = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function colorToArray(color: RGBA): [number, number, number, number] {
  return [color.r, color.g, color.b, color.a];
}

export function serializeProject(project: ProjectData): string {
  const canvases = project.canvases;
  const multiCanvas = canvases !== undefined;
  if (canvases !== undefined && (canvases.length === 0 || canvases.length > MAX_PROJECT_CANVASES)) {
    throw new ProjectFormatError(`Проект должен содержать от 1 до ${MAX_PROJECT_CANVASES} холстов.`);
  }
  if (canvases !== undefined) {
    const ids = new Set<string>();
    let totalPixels = 0;
    for (const canvas of canvases) {
      if (
        typeof canvas.id !== 'string' ||
        canvas.id.length === 0 ||
        canvas.id.length > 80 ||
        !Number.isSafeInteger(canvas.x) ||
        Math.abs(canvas.x) > MAX_PROJECT_CANVAS_COORDINATE ||
        !Number.isSafeInteger(canvas.y) ||
        Math.abs(canvas.y) > MAX_PROJECT_CANVAS_COORDINATE ||
        !isValidCanvasSize(canvas.width, canvas.height) ||
        canvas.pixels.length !== canvas.width * canvas.height * CHANNELS
      ) {
        throw new ProjectFormatError('В проекте указаны некорректные данные холста.');
      }
      if (ids.has(canvas.id)) {
        throw new ProjectFormatError('В проекте повторяется идентификатор холста.');
      }
      ids.add(canvas.id);
      totalPixels += canvas.width * canvas.height;
      if (totalPixels > MAX_PROJECT_TOTAL_PIXELS) {
        throw new ProjectFormatError('Общая площадь холстов в проекте превышает допустимый лимит.');
      }
    }
    if (project.activeCanvasId !== undefined && !ids.has(project.activeCanvasId)) {
      throw new ProjectFormatError('В проекте указан неизвестный активный холст.');
    }
  }
  const common = {
    format: PROJECT_FORMAT,
    version: multiCanvas ? PROJECT_VERSION : 1,
    savedAt: new Date().toISOString(),
    palette: { id: project.paletteId, freeColor: project.freeColor },
    colors: { primary: colorToArray(project.primary), secondary: colorToArray(project.secondary) },
    recent: project.recent.map(colorToArray),
    ...(project.notes ? { notes: project.notes } : {}),
  };
  if (canvases !== undefined) {
    return JSON.stringify({
      ...common,
      activeCanvasId: project.activeCanvasId,
      canvases: canvases.map((canvas) => ({
        ...canvas,
        pixels: bytesToBase64(canvas.pixels),
      })),
    });
  }
  return JSON.stringify({
    ...common,
    width: project.width,
    height: project.height,
    pixels: bytesToBase64(project.pixels),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readColor(value: unknown): RGBA | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [r, g, b, a] = value;
  for (const channel of [r, g, b, a]) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) return null;
  }
  return { r, g, b, a };
}

/** Разбирает JSON проекта; при любой проблеме бросает ProjectFormatError с понятным текстом. */
export function parseProject(text: string): ProjectData {
  if (text.length > MAX_PROJECT_JSON_LENGTH) {
    throw new ProjectFormatError('Файл слишком большой для проекта.');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFormatError('Файл не является корректным JSON.');
  }

  if (!isRecord(raw) || raw.format !== PROJECT_FORMAT) {
    throw new ProjectFormatError('Это не файл проекта редактора пиксель-арта.');
  }

  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ProjectFormatError('В файле проекта не указана версия формата.');
  }
  if (version > PROJECT_VERSION) {
    throw new ProjectFormatError('Проект создан в более новой версии редактора и не может быть открыт.');
  }

  let width: number;
  let height: number;
  let pixels: Uint8ClampedArray;
  let canvases: ProjectCanvasData[] | undefined;
  let activeCanvasId: string | undefined;

  if (version === 2) {
    if (!Array.isArray(raw.canvases) || raw.canvases.length === 0 || raw.canvases.length > MAX_PROJECT_CANVASES) {
      throw new ProjectFormatError(`Проект должен содержать от 1 до ${MAX_PROJECT_CANVASES} холстов.`);
    }
    let totalPixels = 0;
    const ids = new Set<string>();
    canvases = raw.canvases.map((entry): ProjectCanvasData => {
      if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length === 0 || entry.id.length > 80) {
        throw new ProjectFormatError('В проекте указан недопустимый идентификатор холста.');
      }
      if (ids.has(entry.id)) throw new ProjectFormatError('В проекте повторяется идентификатор холста.');
      ids.add(entry.id);
      if (
        typeof entry.x !== 'number' ||
        !Number.isSafeInteger(entry.x) ||
        Math.abs(entry.x) > MAX_PROJECT_CANVAS_COORDINATE ||
        typeof entry.y !== 'number' ||
        !Number.isSafeInteger(entry.y) ||
        Math.abs(entry.y) > MAX_PROJECT_CANVAS_COORDINATE ||
        typeof entry.width !== 'number' ||
        typeof entry.height !== 'number' ||
        !isValidCanvasSize(entry.width, entry.height)
      ) {
        throw new ProjectFormatError('В проекте указан недопустимый размер или позиция холста.');
      }
      totalPixels += entry.width * entry.height;
      if (totalPixels > MAX_PROJECT_TOTAL_PIXELS) throw new ProjectFormatError('Общая площадь холстов в проекте превышает допустимый лимит.');
      return {
        id: entry.id,
        x: entry.x,
        y: entry.y,
        width: entry.width,
        height: entry.height,
        pixels: parsePixelData(entry.pixels, entry.width, entry.height),
      };
    });
    activeCanvasId = typeof raw.activeCanvasId === 'string' && ids.has(raw.activeCanvasId)
      ? raw.activeCanvasId
      : canvases[0]!.id;
    const activeCanvas = canvases.find((canvas) => canvas.id === activeCanvasId)!;
    ({ width, height, pixels } = activeCanvas);
  } else {
    const dimensions = raw;
    if (
      typeof dimensions.width !== 'number' ||
      typeof dimensions.height !== 'number' ||
      !isValidCanvasSize(dimensions.width, dimensions.height)
    ) {
      throw new ProjectFormatError('В проекте указан недопустимый размер холста.');
    }
    width = dimensions.width;
    height = dimensions.height;
    pixels = parsePixelData(raw.pixels, width, height);
  }

  const paletteInfo = isRecord(raw.palette) ? raw.palette : {};
  const known = typeof paletteInfo.id === 'string' && PALETTES.some((p) => p.id === paletteInfo.id);
  const paletteId = known ? (paletteInfo.id as string) : DEFAULT_PALETTE_ID;
  const palette = getPalette(paletteId);
  const freeColor = paletteInfo.freeColor === true;

  const colorInfo = isRecord(raw.colors) ? raw.colors : {};
  let primary = readColor(colorInfo.primary) ?? palette.colors[0];
  let secondary = readColor(colorInfo.secondary) ?? palette.colors[palette.colors.length - 1];
  if (!freeColor) {
    primary = nearestPaletteColor(palette, primary);
    secondary = nearestPaletteColor(palette, secondary);
  }

  const recent: RGBA[] = [];
  if (Array.isArray(raw.recent)) {
    for (const item of raw.recent) {
      const color = readColor(item);
      if (color) recent.push(color);
      if (recent.length >= MAX_RECENT_COLORS) break;
    }
  }

  const notes = typeof raw.notes === 'string' ? raw.notes.slice(0, 200_000) : undefined;
  return { width, height, pixels, paletteId, freeColor, primary, secondary, recent, notes, canvases, activeCanvasId };
}

function parsePixelData(value: unknown, width: number, height: number): Uint8ClampedArray {
  const expectedBytes = width * height * CHANNELS;
  const expectedLength = Math.ceil(expectedBytes / 3) * 4;
  if (typeof value !== 'string' || value.length !== expectedLength) {
    throw new ProjectFormatError('Данные пикселей повреждены или не соответствуют размеру холста.');
  }
  let pixels: Uint8ClampedArray;
  try {
    pixels = base64ToBytes(value);
  } catch {
    throw new ProjectFormatError('Данные пикселей повреждены.');
  }
  if (pixels.length !== expectedBytes) {
    throw new ProjectFormatError('Данные пикселей повреждены или не соответствуют размеру холста.');
  }
  normalizeTransparent(pixels);
  return pixels;
}
