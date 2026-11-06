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
 *   "recent": [[r, g, b, a], …],
 *   "references": [{ "id": "…", "pixels": "<RGBA в base64>", "…" : "…" }]
 * }
 */

import {
  DEFAULT_PALETTE_ID,
  MAX_RECENT_COLORS,
  PALETTES,
  getPalette,
  nearestPaletteColor,
  parseCustomPalettes,
  type Palette,
} from './palette';
import { CHANNELS, isValidCanvasSize, normalizeTransparent, type RGBA } from './state';
import {
  DEFAULT_LAYER_EFFECTS,
  MAX_GROUP_COMPOSITE_PIXELS,
  compositeLayers,
  createRasterLayer,
  updateRasterLayer,
  type LayerBlendMode,
  type LayerEffects,
  type LayerGroup,
  type LayerRole,
} from './layers';
import { isValidLayerEffectStack, type LayerEffect } from './effects';
import {
  isValidReference,
  MAX_PROJECT_REFERENCES,
  MAX_REFERENCE_TOTAL_PIXELS,
  type ReferenceImage,
} from './reference';
import { isValidTilemap, type TilemapData } from './tilemap';
import {
  MAX_ANIMATION_FRAMES,
  MAX_FRAME_DURATION_MS,
  MIN_FRAME_DURATION_MS,
} from './animation';
import {
  MAX_BRUSH_LIBRARY_SIZE,
  parseBrushLibrary,
  type BrushDefinition,
} from './tools/brushLibrary';

export const PROJECT_FORMAT = 'pixel-editor-project';
export const PROJECT_VERSION = 11;
export const MAX_PROJECT_CANVASES = 32;
export const MAX_PROJECT_TOTAL_PIXELS = 4_194_304;
export const MAX_PROJECT_ANIMATION_PIXELS = 16_777_216;
export const MAX_PROJECT_LAYERS = 64;
export const MAX_PROJECT_CANVAS_COORDINATE = 1_000_000;
export const MAX_PROJECT_METADATA_LENGTH = 256 * 1024;
const MAX_PROJECT_METADATA_DEPTH = 12;
const MAX_PROJECT_METADATA_VALUES = 4096;
/** Максимальный размер JSON проекта (символов), рассчитан на холст до 4 мегапикселей. */
export const MAX_PROJECT_JSON_LENGTH = 32 * 1024 * 1024;

export type ProjectMetadataValue =
  | null
  | boolean
  | number
  | string
  | ProjectMetadataValue[]
  | { [key: string]: ProjectMetadataValue };

export interface ProjectMetadata {
  [key: string]: ProjectMetadataValue;
}

export interface ProjectCanvasData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  layers?: ProjectLayerData[];
  groups?: LayerGroup[];
  activeLayerId?: string;
}

export interface ProjectAnimationFrameData {
  id: string;
  durationMs: number;
  pixels: Uint8ClampedArray;
}

export interface ProjectLayerData {
  id: string;
  name: string;
  pixels: Uint8ClampedArray;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: LayerBlendMode;
  alphaLock: boolean;
  clippingMask: boolean;
  role?: LayerRole;
  effects?: LayerEffects;
  filters?: readonly LayerEffect[];
  groupId?: string | null;
  animationFrames?: ProjectAnimationFrameData[];
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
  canvases?: ProjectCanvasData[];
  activeCanvasId?: string;
  references?: ReferenceImage[];
  tilemap?: TilemapData;
  animationFrames?: ProjectAnimationFrameData[];
  brushes?: BrushDefinition[];
  metadata?: ProjectMetadata;
  customPalettes?: Palette[];
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
  const layered = canvases?.some((canvas) => canvas.layers !== undefined) ?? false;
  const references = project.references;
  const tilemap = project.tilemap;
  const animationFrames = project.animationFrames;
  const brushes = project.brushes === undefined ? undefined : parseProjectBrushes(project.brushes);
  const metadata = project.metadata;
  let customPalettes: Palette[] | undefined;
  if (project.customPalettes !== undefined) {
    try {
      customPalettes = parseCustomPalettes(project.customPalettes);
    } catch (error) {
      throw new ProjectFormatError(error instanceof Error ? error.message : 'Некорректные пользовательские палитры.');
    }
  }
  const paletteIds = new Set([
    ...PALETTES.map((entry) => entry.id),
    ...(customPalettes ?? []).map((entry) => entry.id),
  ]);
  if (!paletteIds.has(project.paletteId)) {
    throw new ProjectFormatError('В проекте выбрана неизвестная палитра.');
  }
  if (metadata !== undefined) validateProjectMetadata(metadata);
  const hasLayerAnimationFrames = canvases?.some((canvas) =>
    canvas.layers?.some((layer) => layer.animationFrames !== undefined),
  ) ?? false;
  if (animationFrames !== undefined) {
    if (!Array.isArray(animationFrames) || animationFrames.length === 0 ||
      animationFrames.length > MAX_ANIMATION_FRAMES) {
      throw new ProjectFormatError(`Анимация должна содержать от 1 до ${MAX_ANIMATION_FRAMES} кадров.`);
    }
    const frameIds = new Set<string>();
    let animationPixels = 0;
    for (const frame of animationFrames) {
      if (
        typeof frame.id !== 'string' || frame.id.length === 0 || frame.id.length > 80 ||
        frameIds.has(frame.id) ||
        !Number.isInteger(frame.durationMs) ||
        frame.durationMs < MIN_FRAME_DURATION_MS || frame.durationMs > MAX_FRAME_DURATION_MS ||
        !(frame.pixels instanceof Uint8ClampedArray) ||
        frame.pixels.length !== project.width * project.height * CHANNELS
      ) {
        throw new ProjectFormatError('В проекте указаны некорректные данные кадра анимации.');
      }
      frameIds.add(frame.id);
      animationPixels += project.width * project.height;
      if (animationPixels > MAX_PROJECT_ANIMATION_PIXELS) {
        throw new ProjectFormatError('Общий размер кадров анимации превышает допустимый лимит.');
      }
    }
  }
  if (tilemap !== undefined && !isValidTilemap(tilemap)) {
    throw new ProjectFormatError('В проекте указаны некорректные данные tilemap.');
  }
  if (references !== undefined) {
    if (!Array.isArray(references) || references.length > MAX_PROJECT_REFERENCES) {
      throw new ProjectFormatError(`В проекте может быть не больше ${MAX_PROJECT_REFERENCES} референсов.`);
    }
    let referencePixels = 0;
    const referenceIds = new Set<string>();
    for (const reference of references) {
      if (!isValidReference(reference) || referenceIds.has(reference.id)) {
        throw new ProjectFormatError('В проекте указаны некорректные данные референса.');
      }
      referenceIds.add(reference.id);
      referencePixels += reference.width * reference.height;
      if (referencePixels > MAX_REFERENCE_TOTAL_PIXELS) {
        throw new ProjectFormatError('Общая площадь изображений референсов превышает допустимый лимит.');
      }
    }
  }
  if (canvases !== undefined && (canvases.length === 0 || canvases.length > MAX_PROJECT_CANVASES)) {
    throw new ProjectFormatError(`Проект должен содержать от 1 до ${MAX_PROJECT_CANVASES} холстов.`);
  }
  if (canvases !== undefined) {
    const ids = new Set<string>();
    let totalPixels = 0;
    let totalGroupPixels = 0;
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
      if (layered) {
        const layers = canvas.layers;
        if (!layers || layers.length === 0 || layers.length > MAX_PROJECT_LAYERS) {
          throw new ProjectFormatError(`Каждый холст должен содержать от 1 до ${MAX_PROJECT_LAYERS} слоёв.`);
        }
        const layerIds = new Set<string>();
        for (const layer of layers) {
          if (
            typeof layer.id !== 'string' || layer.id.length === 0 || layer.id.length > 80 ||
            typeof layer.name !== 'string' || layer.name.trim().length === 0 || layer.name.length > 80 ||
            !(layer.blendMode === 'normal' || layer.blendMode === 'multiply' || layer.blendMode === 'screen' ||
              layer.blendMode === 'overlay' || layer.blendMode === 'add') ||
            typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean' ||
            typeof layer.alphaLock !== 'boolean' || typeof layer.clippingMask !== 'boolean' ||
            !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 ||
            (layer.role !== undefined && !['paint', 'background', 'reference'].includes(layer.role)) ||
            (layer.effects !== undefined && !['brightness', 'contrast', 'saturation'].every((key) => {
              const value = layer.effects?.[key as keyof LayerEffects];
              return typeof value === 'number' && Number.isFinite(value) && value >= -100 && value <= 100;
            })) ||
            (layer.filters !== undefined && !isValidLayerEffectStack(layer.filters)) ||
            (layer.groupId !== undefined && layer.groupId !== null &&
              (typeof layer.groupId !== 'string' || layer.groupId.length === 0 || layer.groupId.length > 80)) ||
            layer.pixels.length !== canvas.width * canvas.height * CHANNELS
          ) {
            throw new ProjectFormatError('В проекте указаны некорректные данные слоя.');
          }
          if (layerIds.has(layer.id)) throw new ProjectFormatError('В проекте повторяется идентификатор слоя.');
          layerIds.add(layer.id);
          if (layer.animationFrames !== undefined) {
            validateProjectAnimationFrames(layer.animationFrames, canvas.width, canvas.height);
          }
          totalPixels += canvas.width * canvas.height;
          if (totalPixels > MAX_PROJECT_TOTAL_PIXELS) {
            throw new ProjectFormatError('Общая площадь пиксельных данных проекта превышает допустимый лимит.');
          }
        }
        const groups = canvas.groups ?? [];
        if (groups.length > MAX_PROJECT_LAYERS) throw new ProjectFormatError('В проекте слишком много групп слоёв.');
        totalGroupPixels += groups.length * canvas.width * canvas.height;
        if (totalGroupPixels > MAX_GROUP_COMPOSITE_PIXELS) {
          throw new ProjectFormatError('Общая площадь буферов групп превышает допустимый лимит.');
        }
        const groupIds = new Set<string>();
        for (const group of groups) {
          if (
            typeof group.id !== 'string' || group.id.length === 0 || group.id.length > 80 ||
            layerIds.has(group.id) || groupIds.has(group.id) ||
            typeof group.name !== 'string' || group.name.trim().length === 0 || group.name.length > 80 ||
            (group.parentGroupId !== null &&
              (typeof group.parentGroupId !== 'string' || group.parentGroupId.length === 0 || group.parentGroupId.length > 80)) ||
            typeof group.visible !== 'boolean' || typeof group.locked !== 'boolean' ||
            !Number.isFinite(group.opacity) || group.opacity < 0 || group.opacity > 1 ||
            !(group.blendMode === 'normal' || group.blendMode === 'multiply' || group.blendMode === 'screen' ||
              group.blendMode === 'overlay' || group.blendMode === 'add') ||
            !['brightness', 'contrast', 'saturation'].every((key) => {
              const value = group.effects?.[key as keyof LayerEffects];
              return typeof value === 'number' && Number.isFinite(value) && value >= -100 && value <= 100;
            })
          ) throw new ProjectFormatError('В проекте указаны некорректные данные группы слоёв.');
          groupIds.add(group.id);
        }
        for (const layer of layers) {
          if (layer.groupId && !groupIds.has(layer.groupId)) {
            throw new ProjectFormatError('Слой ссылается на неизвестную группу.');
          }
        }
        const groupMap = new Map(groups.map((group) => [group.id, group]));
        for (const group of groups) {
          if (group.parentGroupId !== null && !groupIds.has(group.parentGroupId)) {
            throw new ProjectFormatError('Группа ссылается на неизвестную родительскую группу.');
          }
          const ancestors = new Set([group.id]);
          let parentId = group.parentGroupId;
          while (parentId) {
            if (ancestors.has(parentId)) throw new ProjectFormatError('Вложенность групп содержит цикл.');
            ancestors.add(parentId);
            parentId = groupMap.get(parentId)?.parentGroupId ?? null;
          }
        }
        if (canvas.activeLayerId !== undefined && !layerIds.has(canvas.activeLayerId)) {
          throw new ProjectFormatError('В проекте указан неизвестный активный слой.');
        }
      } else {
        totalPixels += canvas.width * canvas.height;
      }
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
    version: customPalettes !== undefined
      ? 11
      : brushes !== undefined || metadata !== undefined
      ? 10
      : animationFrames !== undefined || hasLayerAnimationFrames
      ? 9
      : tilemap !== undefined
      ? 8
      : canvases?.some((canvas) => canvas.layers?.some((layer) => (layer.filters?.length ?? 0) > 0))
        ? 7
        : references !== undefined ? 6 : multiCanvas ? (layered ? 5 : 2) : 1,
    savedAt: new Date().toISOString(),
    palette: { id: project.paletteId, freeColor: project.freeColor },
    colors: { primary: colorToArray(project.primary), secondary: colorToArray(project.secondary) },
    recent: project.recent.map(colorToArray),
    ...(brushes !== undefined ? { brushes } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(customPalettes !== undefined ? { customPalettes } : {}),
  };
  if (canvases !== undefined) {
    const serialized = JSON.stringify({
      ...common,
      activeCanvasId: project.activeCanvasId,
      ...(references !== undefined
        ? { references: references.map((reference) => ({ ...reference, pixels: bytesToBase64(reference.pixels) })) }
        : {}),
      ...(tilemap !== undefined
        ? { tilemap: { ...tilemap, tiles: tilemap.tiles.map((tile) => ({ ...tile, pixels: bytesToBase64(tile.pixels) })) } }
        : {}),
      ...(animationFrames !== undefined
        ? { animationFrames: animationFrames.map((frame) => ({
            id: frame.id,
            durationMs: frame.durationMs,
            pixels: bytesToBase64(frame.pixels),
          })) }
        : {}),
      canvases: canvases.map((canvas) => layered
        ? {
            id: canvas.id,
            x: canvas.x,
            y: canvas.y,
            width: canvas.width,
            height: canvas.height,
            activeLayerId: canvas.activeLayerId,
            groups: canvas.groups ?? [],
            layers: canvas.layers!.map((layer) => {
              const { filters, ...savedLayer } = layer;
              return {
                ...savedLayer,
                role: layer.role ?? 'paint',
                effects: layer.effects ?? { ...DEFAULT_LAYER_EFFECTS },
                ...(filters && filters.length > 0 ? { filters } : {}),
                ...(layer.animationFrames !== undefined
                  ? { animationFrames: layer.animationFrames.map((frame) => ({
                      id: frame.id,
                      durationMs: frame.durationMs,
                      pixels: bytesToBase64(frame.pixels),
                    })) }
                  : {}),
                groupId: layer.groupId ?? null,
                pixels: bytesToBase64(layer.pixels),
              };
            }),
          }
        : {
            ...canvas,
            pixels: bytesToBase64(canvas.pixels),
          }),
    });
    if (serialized.length > MAX_PROJECT_JSON_LENGTH) {
      throw new ProjectFormatError('Файл проекта превышает допустимый размер.');
    }
    return serialized;
  }
  const serialized = JSON.stringify({
    ...common,
    width: project.width,
    height: project.height,
    pixels: bytesToBase64(project.pixels),
    ...(references !== undefined
      ? { references: references.map((reference) => ({ ...reference, pixels: bytesToBase64(reference.pixels) })) }
      : {}),
    ...(tilemap !== undefined
      ? { tilemap: { ...tilemap, tiles: tilemap.tiles.map((tile) => ({ ...tile, pixels: bytesToBase64(tile.pixels) })) } }
      : {}),
    ...(animationFrames !== undefined
      ? { animationFrames: animationFrames.map((frame) => ({
          id: frame.id,
          durationMs: frame.durationMs,
          pixels: bytesToBase64(frame.pixels),
        })) }
      : {}),
  });
  if (serialized.length > MAX_PROJECT_JSON_LENGTH) {
    throw new ProjectFormatError('Файл проекта превышает допустимый размер.');
  }
  return serialized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseProjectBrushes(value: unknown): BrushDefinition[] {
  if (!Array.isArray(value) || value.length > MAX_BRUSH_LIBRARY_SIZE) {
    throw new ProjectFormatError(`Проект может содержать не больше ${MAX_BRUSH_LIBRARY_SIZE} кистей.`);
  }
  try {
    return parseBrushLibrary(JSON.stringify(value));
  } catch (error) {
    throw new ProjectFormatError(
      `В проекте указаны некорректные данные кистей: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isProjectMetadataValue(
  value: unknown,
  depth: number,
  counter: { count: number },
): value is ProjectMetadataValue {
  counter.count++;
  if (counter.count > MAX_PROJECT_METADATA_VALUES || depth > MAX_PROJECT_METADATA_DEPTH) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 8192;
  if (Array.isArray(value)) {
    if (value.length > 512) return false;
    for (let index = 0; index < value.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(value, index) ||
        !isProjectMetadataValue(value[index], depth + 1, counter)) return false;
    }
    return true;
  }
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const entries = Object.entries(value);
  return entries.length <= 512 && entries.every(([key, item]) =>
    key.length > 0 &&
    key.length <= 256 &&
    key !== '__proto__' &&
    key !== 'prototype' &&
    key !== 'constructor' &&
    isProjectMetadataValue(item, depth + 1, counter),
  );
}

function validateProjectMetadata(value: unknown): asserts value is ProjectMetadata {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ProjectFormatError('Метаданные проекта должны быть JSON-объектом.');
  }
  if (!isProjectMetadataValue(value, 0, { count: 0 })) {
    throw new ProjectFormatError('В метаданных проекта есть недопустимое или слишком большое значение.');
  }
  try {
    if (JSON.stringify(value).length > MAX_PROJECT_METADATA_LENGTH) {
      throw new ProjectFormatError('Метаданные проекта превышают допустимый размер.');
    }
  } catch (error) {
    if (error instanceof ProjectFormatError) throw error;
    throw new ProjectFormatError('Метаданные проекта невозможно сохранить в JSON.');
  }
}

export function parseProjectMetadataJson(json: string): ProjectMetadata {
  if (json.length > MAX_PROJECT_METADATA_LENGTH) {
    throw new ProjectFormatError('Метаданные проекта превышают допустимый размер.');
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new ProjectFormatError('Метаданные должны содержать корректный JSON.');
  }
  validateProjectMetadata(value);
  return value;
}

function validateProjectAnimationFrames(
  frames: readonly ProjectAnimationFrameData[],
  width: number,
  height: number,
): void {
  if (!Array.isArray(frames) || frames.length === 0 || frames.length > MAX_ANIMATION_FRAMES) {
    throw new ProjectFormatError(`Анимация должна содержать от 1 до ${MAX_ANIMATION_FRAMES} кадров.`);
  }
  const ids = new Set<string>();
  for (const frame of frames) {
    if (
      typeof frame.id !== 'string' || frame.id.length === 0 || frame.id.length > 80 || ids.has(frame.id) ||
      !Number.isInteger(frame.durationMs) ||
      frame.durationMs < MIN_FRAME_DURATION_MS || frame.durationMs > MAX_FRAME_DURATION_MS ||
      !(frame.pixels instanceof Uint8ClampedArray) ||
      frame.pixels.length !== width * height * CHANNELS
    ) {
      throw new ProjectFormatError('В проекте указаны некорректные данные кадра анимации.');
    }
    ids.add(frame.id);
  }
  if (frames.length * width * height > MAX_PROJECT_ANIMATION_PIXELS) {
    throw new ProjectFormatError('Общий размер кадров анимации превышает допустимый лимит.');
  }
}

function parseProjectAnimationFrames(
  value: unknown,
  width: number,
  height: number,
): ProjectAnimationFrameData[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ANIMATION_FRAMES) {
    throw new ProjectFormatError(`Анимация должна содержать от 1 до ${MAX_ANIMATION_FRAMES} кадров.`);
  }
  const ids = new Set<string>();
  const frames = value.map((entry): ProjectAnimationFrameData => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length === 0 || entry.id.length > 80 ||
      ids.has(entry.id) || typeof entry.durationMs !== 'number' || !Number.isInteger(entry.durationMs) ||
      entry.durationMs < MIN_FRAME_DURATION_MS || entry.durationMs > MAX_FRAME_DURATION_MS) {
      throw new ProjectFormatError('В проекте указаны некорректные данные кадра анимации.');
    }
    ids.add(entry.id);
    return {
      id: entry.id,
      durationMs: entry.durationMs,
      pixels: parsePixelData(entry.pixels, width, height),
    };
  });
  if (frames.length * width * height > MAX_PROJECT_ANIMATION_PIXELS) {
    throw new ProjectFormatError('Общий размер кадров анимации превышает допустимый лимит.');
  }
  return frames;
}

function isLayerEffects(value: unknown): value is LayerEffects {
  return isRecord(value) && ['brightness', 'contrast', 'saturation'].every((key) => {
    const channel = value[key];
    return typeof channel === 'number' && Number.isFinite(channel) && channel >= -100 && channel <= 100;
  });
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
  let references: ReferenceImage[] | undefined;
  let tilemap: TilemapData | undefined;
  let animationFrames: ProjectAnimationFrameData[] | undefined;
  let brushes: BrushDefinition[] | undefined;
  let metadata: ProjectMetadata | undefined;
  let customPalettes: Palette[] | undefined;

  if ((version >= 2 && version <= 5) || (version >= 6 && raw.canvases !== undefined)) {
    if (!Array.isArray(raw.canvases) || raw.canvases.length === 0 || raw.canvases.length > MAX_PROJECT_CANVASES) {
      throw new ProjectFormatError(`Проект должен содержать от 1 до ${MAX_PROJECT_CANVASES} холстов.`);
    }
    let totalPixels = 0;
    let totalGroupPixels = 0;
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
      const canvasWidth = entry.width;
      const canvasHeight = entry.height;
      let layerData: ProjectLayerData[] | undefined;
      let groupData: LayerGroup[] = [];
      let activeLayerId: string | undefined;
      if (version >= 3 && (version <= 5 || entry.layers !== undefined)) {
        if (!Array.isArray(entry.layers) || entry.layers.length === 0 || entry.layers.length > MAX_PROJECT_LAYERS) {
          throw new ProjectFormatError(`Каждый холст должен содержать от 1 до ${MAX_PROJECT_LAYERS} слоёв.`);
        }
        const layerIds = new Set<string>();
        layerData = entry.layers.map((item): ProjectLayerData => {
          if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0 || item.id.length > 80 ||
            typeof item.name !== 'string' || item.name.trim().length === 0 || item.name.length > 80) {
            throw new ProjectFormatError('В проекте указаны некорректные данные слоя.');
          }
          if (layerIds.has(item.id)) throw new ProjectFormatError('В проекте повторяется идентификатор слоя.');
          layerIds.add(item.id);
          const blendMode = item.blendMode;
          const role = item.role;
          const rawEffects = item.effects;
          const rawFilters = item.filters;
          const groupId = item.groupId;
          if (
            typeof item.visible !== 'boolean' || typeof item.locked !== 'boolean' ||
            typeof item.alphaLock !== 'boolean' || typeof item.clippingMask !== 'boolean' ||
            typeof item.opacity !== 'number' || !Number.isFinite(item.opacity) || item.opacity < 0 || item.opacity > 1 ||
            !(blendMode === 'normal' || blendMode === 'multiply' || blendMode === 'screen' ||
              blendMode === 'overlay' || blendMode === 'add') ||
            (version >= 4 && role !== 'paint' && role !== 'background' && role !== 'reference') ||
            (version >= 4 && (!isRecord(rawEffects) ||
              !['brightness', 'contrast', 'saturation'].every((key) =>
                typeof rawEffects[key] === 'number' && Number.isFinite(rawEffects[key]) &&
                (rawEffects[key] as number) >= -100 && (rawEffects[key] as number) <= 100))) ||
            (version >= 7 && rawFilters !== undefined && !isValidLayerEffectStack(rawFilters)) ||
            (version >= 5 && groupId !== null &&
              (typeof groupId !== 'string' || groupId.length === 0 || groupId.length > 80))
          ) {
            throw new ProjectFormatError('В проекте указаны некорректные параметры слоя.');
          }
          totalPixels += canvasWidth * canvasHeight;
          if (totalPixels > MAX_PROJECT_TOTAL_PIXELS) {
            throw new ProjectFormatError('Общая площадь пиксельных данных проекта превышает допустимый лимит.');
          }
          return {
            id: item.id,
            name: item.name.trim(),
            visible: item.visible,
            locked: item.locked,
            alphaLock: item.alphaLock,
            clippingMask: item.clippingMask,
            opacity: item.opacity,
            blendMode,
            role: version >= 4 ? role as LayerRole : 'paint',
            effects: version >= 4 ? rawEffects as LayerEffects : { ...DEFAULT_LAYER_EFFECTS },
            filters: version >= 7 ? (rawFilters as LayerEffect[] | undefined) ?? [] : [],
            groupId: version >= 5 ? groupId as string | null : null,
            pixels: parsePixelData(item.pixels, canvasWidth, canvasHeight),
            animationFrames: version >= 9
              ? parseProjectAnimationFrames(item.animationFrames, canvasWidth, canvasHeight)
              : undefined,
          };
        });
        if (version >= 5) {
          if (!Array.isArray(entry.groups) || entry.groups.length > MAX_PROJECT_LAYERS) {
            throw new ProjectFormatError('В проекте указаны некорректные группы слоёв.');
          }
          const groupIds = new Set<string>();
          groupData = entry.groups.map((value): LayerGroup => {
            if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 80 ||
              layerIds.has(value.id) || groupIds.has(value.id) ||
              typeof value.name !== 'string' || value.name.trim().length === 0 || value.name.length > 80 ||
              (value.parentGroupId !== null &&
                (typeof value.parentGroupId !== 'string' || value.parentGroupId.length === 0 || value.parentGroupId.length > 80)) ||
              typeof value.visible !== 'boolean' || typeof value.locked !== 'boolean' ||
              typeof value.opacity !== 'number' || !Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 1 ||
              !(value.blendMode === 'normal' || value.blendMode === 'multiply' || value.blendMode === 'screen' ||
                value.blendMode === 'overlay' || value.blendMode === 'add') || !isLayerEffects(value.effects)) {
              throw new ProjectFormatError('В проекте указаны некорректные данные группы слоёв.');
            }
            groupIds.add(value.id);
            return {
              id: value.id,
              name: value.name.trim(),
              parentGroupId: value.parentGroupId as string | null,
              visible: value.visible,
              locked: value.locked,
              opacity: value.opacity,
              blendMode: value.blendMode,
              effects: value.effects as unknown as LayerEffects,
            };
          });
          for (const group of groupData) {
            if (group.parentGroupId !== null && !groupIds.has(group.parentGroupId)) {
              throw new ProjectFormatError('Группа ссылается на неизвестную родительскую группу.');
            }
            const ancestors = new Set([group.id]);
            let parentId = group.parentGroupId;
            while (parentId) {
              if (ancestors.has(parentId)) throw new ProjectFormatError('Вложенность групп содержит цикл.');
              ancestors.add(parentId);
              parentId = groupData.find((candidate) => candidate.id === parentId)?.parentGroupId ?? null;
            }
          }
          for (const layer of layerData) {
            if (layer.groupId && !groupIds.has(layer.groupId)) {
              throw new ProjectFormatError('Слой ссылается на неизвестную группу.');
            }
          }
          totalGroupPixels += groupData.length * canvasWidth * canvasHeight;
          if (totalGroupPixels > MAX_GROUP_COMPOSITE_PIXELS) {
            throw new ProjectFormatError('Общая площадь буферов групп превышает допустимый лимит.');
          }
        }
        activeLayerId = typeof entry.activeLayerId === 'string' && layerIds.has(entry.activeLayerId)
          ? entry.activeLayerId
          : layerData[0]!.id;
      } else {
        totalPixels += canvasWidth * canvasHeight;
        if (totalPixels > MAX_PROJECT_TOTAL_PIXELS) {
          throw new ProjectFormatError('Общая площадь холстов в проекте превышает допустимый лимит.');
        }
      }
      const pixels = layerData
        ? compositeLayers(
            canvasWidth,
            canvasHeight,
            layerData.map((layer) => updateRasterLayer(
              createRasterLayer(layer.id, layer.name, canvasWidth, canvasHeight, layer.pixels),
              {
                visible: layer.visible,
                locked: layer.locked,
                opacity: layer.opacity,
                blendMode: layer.blendMode,
                alphaLock: layer.alphaLock,
                clippingMask: layer.clippingMask,
                role: layer.role,
                effects: layer.effects,
                filters: layer.filters,
                groupId: layer.groupId,
              },
            )),
            undefined,
            undefined,
            groupData,
          ).data
        : parsePixelData(entry.pixels, canvasWidth, canvasHeight);
      return {
        id: entry.id,
        x: entry.x,
        y: entry.y,
        width: entry.width,
        height: entry.height,
        pixels,
        layers: layerData,
        groups: groupData,
        activeLayerId,
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

  if (version >= 6) {
    if (raw.references !== undefined && !Array.isArray(raw.references)) {
      throw new ProjectFormatError('В проекте указаны некорректные референсы.');
    }
    const rawReferences = raw.references ?? [];
    if (rawReferences.length > MAX_PROJECT_REFERENCES) {
      throw new ProjectFormatError(`В проекте может быть не больше ${MAX_PROJECT_REFERENCES} референсов.`);
    }
    let referencePixels = 0;
    const referenceIds = new Set<string>();
    references = rawReferences.map((value): ReferenceImage => {
      if (!isRecord(value) || typeof value.pixels !== 'string') {
        throw new ProjectFormatError('В проекте указаны некорректные данные референса.');
      }
      const { id, name, width, height, x, y, scale, rotation, opacity, visible, locked, pixels: encodedPixels } = value;
      if (
        typeof id !== 'string' ||
        typeof name !== 'string' ||
        typeof width !== 'number' ||
        typeof height !== 'number' ||
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        typeof scale !== 'number' ||
        typeof rotation !== 'number' ||
        typeof opacity !== 'number' ||
        typeof visible !== 'boolean' ||
        typeof locked !== 'boolean' ||
        typeof encodedPixels !== 'string' ||
        !isValidCanvasSize(width, height)
      ) {
        throw new ProjectFormatError('В проекте указаны некорректные данные референса.');
      }
      const reference: ReferenceImage = {
        id,
        name,
        width,
        height,
        x,
        y,
        scale,
        rotation,
        opacity,
        visible,
        locked,
        pixels: parsePixelData(encodedPixels, width, height),
      };
      if (!isValidReference(reference) || referenceIds.has(reference.id)) {
        throw new ProjectFormatError('В проекте указаны некорректные данные референса.');
      }
      referenceIds.add(reference.id);
      referencePixels += reference.width * reference.height;
      if (referencePixels > MAX_REFERENCE_TOTAL_PIXELS) {
        throw new ProjectFormatError('Общая площадь изображений референсов превышает допустимый лимит.');
      }
      return reference;
    });
  }

  if (version >= 8 && raw.tilemap !== undefined) {
    tilemap = parseTilemapData(raw.tilemap);
  }

  if (version >= 9 && raw.animationFrames !== undefined) {
    if (!Array.isArray(raw.animationFrames) || raw.animationFrames.length === 0 ||
      raw.animationFrames.length > MAX_ANIMATION_FRAMES) {
      throw new ProjectFormatError(`Анимация должна содержать от 1 до ${MAX_ANIMATION_FRAMES} кадров.`);
    }
    const frameIds = new Set<string>();
    let animationPixels = 0;
    animationFrames = raw.animationFrames.map((entry): ProjectAnimationFrameData => {
      if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length === 0 || entry.id.length > 80 ||
        frameIds.has(entry.id) ||
        typeof entry.durationMs !== 'number' || !Number.isInteger(entry.durationMs) ||
        entry.durationMs < MIN_FRAME_DURATION_MS || entry.durationMs > MAX_FRAME_DURATION_MS) {
        throw new ProjectFormatError('В проекте указаны некорректные данные кадра анимации.');
      }
      frameIds.add(entry.id);
      animationPixels += width * height;
      if (animationPixels > MAX_PROJECT_ANIMATION_PIXELS) {
        throw new ProjectFormatError('Общий размер кадров анимации превышает допустимый лимит.');
      }
      return {
        id: entry.id,
        durationMs: entry.durationMs,
        pixels: parsePixelData(entry.pixels, width, height),
      };
    });
  }

  if (version >= 10) {
    if (raw.brushes !== undefined) brushes = parseProjectBrushes(raw.brushes);
    if (raw.metadata !== undefined) {
      validateProjectMetadata(raw.metadata);
      metadata = raw.metadata;
    }
  }
  if (version >= 11 && raw.customPalettes !== undefined) {
    try {
      customPalettes = parseCustomPalettes(raw.customPalettes);
    } catch (error) {
      throw new ProjectFormatError(error instanceof Error ? error.message : 'Некорректные пользовательские палитры.');
    }
  }

  const paletteInfo = isRecord(raw.palette) ? raw.palette : {};
  const known = typeof paletteInfo.id === 'string' &&
    (PALETTES.some((p) => p.id === paletteInfo.id) ||
      (customPalettes ?? []).some((p) => p.id === paletteInfo.id));
  const paletteId = known ? (paletteInfo.id as string) : DEFAULT_PALETTE_ID;
  const palette = PALETTES.find((entry) => entry.id === paletteId) ??
    customPalettes?.find((entry) => entry.id === paletteId) ??
    getPalette(DEFAULT_PALETTE_ID);
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

  return {
    width, height, pixels, paletteId, freeColor, primary, secondary, recent, canvases,
    activeCanvasId, references, tilemap, animationFrames, brushes, metadata, customPalettes,
  };
}

function parseTilemapData(value: unknown): TilemapData {
  if (
    !isRecord(value) ||
    !Array.isArray(value.tiles) ||
    typeof value.tileWidth !== 'number' ||
    typeof value.tileHeight !== 'number' ||
    !isValidCanvasSize(value.tileWidth, value.tileHeight)
  ) throw new ProjectFormatError('В проекте указаны некорректные данные tilemap.');

  const tiles = value.tiles.map((entry) => {
    if (!isRecord(entry) || typeof entry.pixels !== 'string') {
      throw new ProjectFormatError('В проекте указаны некорректные данные тайла.');
    }
    return {
      ...entry,
      pixels: parsePixelData(entry.pixels, value.tileWidth as number, value.tileHeight as number),
    };
  });
  const map = { ...value, tiles };
  if (!isValidTilemap(map)) throw new ProjectFormatError('В проекте указаны некорректные данные tilemap.');
  return map;
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
