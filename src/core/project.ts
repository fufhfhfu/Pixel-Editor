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

export const PROJECT_FORMAT = 'pixel-editor-project';
export const PROJECT_VERSION = 5;
export const MAX_PROJECT_CANVASES = 32;
export const MAX_PROJECT_TOTAL_PIXELS = 4_194_304;
export const MAX_PROJECT_LAYERS = 64;
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
  layers?: ProjectLayerData[];
  groups?: LayerGroup[];
  activeLayerId?: string;
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
  groupId?: string | null;
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
            (layer.groupId !== undefined && layer.groupId !== null &&
              (typeof layer.groupId !== 'string' || layer.groupId.length === 0 || layer.groupId.length > 80)) ||
            layer.pixels.length !== canvas.width * canvas.height * CHANNELS
          ) {
            throw new ProjectFormatError('В проекте указаны некорректные данные слоя.');
          }
          if (layerIds.has(layer.id)) throw new ProjectFormatError('В проекте повторяется идентификатор слоя.');
          layerIds.add(layer.id);
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
    version: multiCanvas ? (layered ? PROJECT_VERSION : 2) : 1,
    savedAt: new Date().toISOString(),
    palette: { id: project.paletteId, freeColor: project.freeColor },
    colors: { primary: colorToArray(project.primary), secondary: colorToArray(project.secondary) },
    recent: project.recent.map(colorToArray),
  };
  if (canvases !== undefined) {
    return JSON.stringify({
      ...common,
      activeCanvasId: project.activeCanvasId,
      canvases: canvases.map((canvas) => layered
        ? {
            id: canvas.id,
            x: canvas.x,
            y: canvas.y,
            width: canvas.width,
            height: canvas.height,
            activeLayerId: canvas.activeLayerId,
            groups: canvas.groups ?? [],
            layers: canvas.layers!.map((layer) => ({
              ...layer,
              role: layer.role ?? 'paint',
              effects: layer.effects ?? { ...DEFAULT_LAYER_EFFECTS },
              groupId: layer.groupId ?? null,
              pixels: bytesToBase64(layer.pixels),
            })),
          }
        : {
            ...canvas,
            pixels: bytesToBase64(canvas.pixels),
          }),
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

  if (version === 2 || version === 3 || version === 4 || version === 5) {
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
      if (version >= 3) {
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
            groupId: version >= 5 ? groupId as string | null : null,
            pixels: parsePixelData(item.pixels, canvasWidth, canvasHeight),
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

  return { width, height, pixels, paletteId, freeColor, primary, secondary, recent, canvases, activeCanvasId };
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
