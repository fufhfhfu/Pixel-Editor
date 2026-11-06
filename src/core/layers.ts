import { PixelBuffer, type DirtyRect } from './state';
import {
  applyLayerEffectStack,
  isValidLayerEffectStack,
  layerEffectPadding,
  type LayerEffect,
} from './effects';

export type LayerBlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'add';
export type LayerRole = 'paint' | 'background' | 'reference';

export interface LayerEffects {
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface LayerGroup {
  readonly id: string;
  readonly name: string;
  readonly parentGroupId: string | null;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  readonly blendMode: LayerBlendMode;
  readonly effects: LayerEffects;
}

export interface RasterLayer {
  readonly id: string;
  readonly name: string;
  readonly buffer: PixelBuffer;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  readonly blendMode: LayerBlendMode;
  readonly alphaLock: boolean;
  readonly clippingMask: boolean;
  readonly role?: LayerRole;
  readonly effects?: LayerEffects;
  readonly filters?: readonly LayerEffect[];
  readonly groupId?: string | null;
}

export type LayerUpdate = Partial<Omit<RasterLayer, 'id' | 'buffer' | 'effects' | 'filters' | 'groupId'>> &
  { effects?: Partial<LayerEffects>; filters?: readonly LayerEffect[]; groupId?: string | null };
export type LayerGroupUpdate = Partial<Omit<LayerGroup, 'id' | 'parentGroupId' | 'effects'>> &
  { effects?: Partial<LayerEffects> };

const BLEND_MODES = new Set<LayerBlendMode>(['normal', 'multiply', 'screen', 'overlay', 'add']);
const LAYER_ROLES = new Set<LayerRole>(['paint', 'background', 'reference']);
export const DEFAULT_LAYER_EFFECTS: LayerEffects = { brightness: 0, contrast: 0, saturation: 0 };
export const MAX_GROUP_COMPOSITE_PIXELS = 4_194_304;

export function createLayerGroup(
  id: string,
  name: string,
  parentGroupId: string | null = null,
): LayerGroup {
  if (!id || id.length > 80) throw new RangeError('Group id must contain 1 to 80 characters.');
  return {
    id,
    name: normalizeLayerName(name),
    parentGroupId,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    effects: { ...DEFAULT_LAYER_EFFECTS },
  };
}

export function updateLayerGroup(group: LayerGroup, update: LayerGroupUpdate): LayerGroup {
  const name = update.name === undefined ? group.name : normalizeLayerName(update.name);
  if (update.opacity !== undefined && (!Number.isFinite(update.opacity) || update.opacity < 0 || update.opacity > 1)) {
    throw new RangeError('Group opacity must be between 0 and 1.');
  }
  if (update.blendMode !== undefined && !BLEND_MODES.has(update.blendMode)) {
    throw new RangeError('Unsupported group blend mode.');
  }
  const effects = update.effects === undefined
    ? group.effects
    : { ...group.effects, ...update.effects };
  for (const [effect, value] of Object.entries(effects)) {
    if (!Number.isFinite(value) || value < -100 || value > 100) {
      throw new RangeError(`Group ${effect} must be between -100 and 100.`);
    }
  }
  return { ...group, ...update, name, effects };
}

export function createRasterLayer(
  id: string,
  name: string,
  width: number,
  height: number,
  pixels?: Uint8ClampedArray,
): RasterLayer {
  if (!id || id.length > 80) throw new RangeError('Layer id must contain 1 to 80 characters.');
  const buffer = new PixelBuffer(width, height, pixels);
  return {
    id,
    name: normalizeLayerName(name),
    buffer,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    alphaLock: false,
    clippingMask: false,
    role: 'paint',
    effects: { ...DEFAULT_LAYER_EFFECTS },
    filters: [],
  };
}

export function normalizeLayerName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 80) {
    throw new RangeError('Layer name must contain 1 to 80 characters.');
  }
  return normalized;
}

export function updateRasterLayer(layer: RasterLayer, update: LayerUpdate): RasterLayer {
  const name = update.name === undefined ? layer.name : normalizeLayerName(update.name);
  if (update.opacity !== undefined && (!Number.isFinite(update.opacity) || update.opacity < 0 || update.opacity > 1)) {
    throw new RangeError('Layer opacity must be between 0 and 1.');
  }
  if (update.blendMode !== undefined && !BLEND_MODES.has(update.blendMode)) {
    throw new RangeError('Unsupported layer blend mode.');
  }
  if (update.role !== undefined && !LAYER_ROLES.has(update.role)) throw new RangeError('Unsupported layer role.');
  const effects = update.effects === undefined
    ? layer.effects ?? { ...DEFAULT_LAYER_EFFECTS }
    : { ...(layer.effects ?? DEFAULT_LAYER_EFFECTS), ...update.effects };
  for (const [effect, value] of Object.entries(effects)) {
    if (!Number.isFinite(value) || value < -100 || value > 100) {
      throw new RangeError(`Layer ${effect} must be between -100 and 100.`);
    }
  }
  const filters = update.filters ?? layer.filters ?? [];
  if (!isValidLayerEffectStack(filters)) throw new RangeError('Layer effect stack is invalid.');
  const role = update.role ?? layer.role ?? 'paint';
  const nonEditable = role === 'background' || role === 'reference';
  return {
    ...layer,
    ...update,
    name,
    role,
    effects,
    filters,
    locked: nonEditable ? true : update.locked ?? layer.locked,
    alphaLock: nonEditable ? false : update.alphaLock ?? layer.alphaLock,
  };
}

interface LayerFilterCache {
  readonly revision: number;
  readonly filters: readonly LayerEffect[];
  readonly output: PixelBuffer;
}

const layerFilterCache = new WeakMap<PixelBuffer, LayerFilterCache>();

function getRenderedLayerBuffer(layer: RasterLayer): PixelBuffer {
  const filters = layer.filters ?? [];
  if (filters.length === 0 || !filters.some((effect) => effect.enabled)) return layer.buffer;
  const cached = layerFilterCache.get(layer.buffer);
  if (cached && cached.revision === layer.buffer.revision && cached.filters === filters) return cached.output;
  const output = applyLayerEffectStack(layer.buffer, filters);
  layerFilterCache.set(layer.buffer, { revision: layer.buffer.revision, filters, output });
  return output;
}

function blendChannel(backdrop: number, source: number, mode: LayerBlendMode): number {
  switch (mode) {
    case 'multiply': return backdrop * source;
    case 'screen': return backdrop + source - backdrop * source;
    case 'overlay': return backdrop <= 0.5 ? 2 * backdrop * source : 1 - 2 * (1 - backdrop) * (1 - source);
    case 'add': return Math.min(1, backdrop + source);
    default: return source;
  }
}

function effectChannel(data: Uint8ClampedArray, offset: number, channel: number, effects: LayerEffects): number {
  const brightness = effects.brightness * 2.55;
  const contrast = effects.contrast;
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const luminance = 0.2126 * data[offset]! + 0.7152 * data[offset + 1]! + 0.0722 * data[offset + 2]!;
  const saturated = luminance + (data[offset + channel]! - luminance) * (1 + effects.saturation / 100);
  return Math.max(0, Math.min(255, contrastFactor * (saturated + brightness - 128) + 128));
}

function compositePixel(
  output: Uint8ClampedArray,
  offset: number,
  source: Uint8ClampedArray,
  sourceAlphaByte: number,
  opacity: number,
  mode: LayerBlendMode,
  effects: LayerEffects,
): void {
  const backdropAlpha = output[offset + 3] / 255;
  const sourceAlpha = (sourceAlphaByte / 255) * opacity;
  const alpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
  if (alpha === 0) {
    output.fill(0, offset, offset + 4);
    return;
  }
  for (let channel = 0; channel < 3; channel++) {
    const b = output[offset + channel] / 255;
    const s = effectChannel(source, offset, channel, effects) / 255;
    const blended = blendChannel(b, s, mode);
    output[offset + channel] = Math.round(255 * (
      backdropAlpha * (1 - sourceAlpha) * b +
      sourceAlpha * (1 - backdropAlpha) * s +
      backdropAlpha * sourceAlpha * blended
    ) / alpha);
  }
  output[offset + 3] = Math.round(alpha * 255);
}

export function compositeLayers(
  width: number,
  height: number,
  layers: readonly RasterLayer[],
  output = new PixelBuffer(width, height),
  dirty: DirtyRect = { x: 0, y: 0, width, height },
  groups: readonly LayerGroup[] = [],
  groupBuffers = new Map<string, PixelBuffer>(),
): PixelBuffer {
  if (layers.length === 0) throw new RangeError('A layer stack must contain at least one layer.');
  if (groups.length * width * height > MAX_GROUP_COMPOSITE_PIXELS) {
    throw new RangeError('Group composite buffers exceed the project memory limit.');
  }
  if (output.width !== width || output.height !== height) throw new RangeError('Composite buffer dimensions must match.');
  if (![dirty.x, dirty.y, dirty.width, dirty.height].every(Number.isFinite) || dirty.width < 0 || dirty.height < 0) {
    throw new RangeError('Composite dirty rectangle must contain finite, non-negative dimensions.');
  }
  const ids = new Set<string>();
  for (const layer of layers) {
    if (ids.has(layer.id)) throw new RangeError('Layer ids must be unique within a layer stack.');
    ids.add(layer.id);
    if (layer.buffer === output) throw new RangeError('The composite output cannot also be a source layer.');
    if (layer.buffer.width !== width || layer.buffer.height !== height) {
      throw new RangeError('All layers in a stack must have matching dimensions.');
    }
  }
  const groupIds = new Set<string>();
  const groupById = new Map<string, LayerGroup>();
  for (const group of groups) {
    if (ids.has(group.id) || groupIds.has(group.id)) throw new RangeError('Layer and group ids must be unique.');
    groupIds.add(group.id);
    groupById.set(group.id, group);
  }
  for (const layer of layers) {
    if (layer.groupId && !groupIds.has(layer.groupId)) throw new RangeError('Layer references an unknown group.');
  }
  for (const group of groups) {
    if (group.parentGroupId && !groupIds.has(group.parentGroupId)) throw new RangeError('Group references an unknown parent.');
    const ancestors = new Set<string>([group.id]);
    let parent = group.parentGroupId;
    while (parent) {
      if (ancestors.has(parent)) throw new RangeError('Layer group hierarchy cannot contain cycles.');
      ancestors.add(parent);
      parent = groupById.get(parent)?.parentGroupId ?? null;
    }
  }
  const effectPadding = layers.reduce((padding, layer) =>
    Math.max(padding, layerEffectPadding(layer.filters ?? [])), 0);
  const x0 = Math.max(0, Math.floor(dirty.x - effectPadding));
  const y0 = Math.max(0, Math.floor(dirty.y - effectPadding));
  const x1 = Math.min(width, Math.ceil(dirty.x + dirty.width + effectPadding));
  const y1 = Math.min(height, Math.ceil(dirty.y + dirty.height + effectPadding));
  if (x0 >= x1 || y0 >= y1) return output;
  const updated = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  for (let y = y0; y < y1; y++) {
    const start = (y * width + x0) * 4;
    output.data.fill(0, start, start + updated.width * 4);
  }

  const layerOrder = new Map(layers.map((layer, index) => [layer.id, index]));
  const firstLayerIndex = (groupId: string): number => {
    let first = Number.POSITIVE_INFINITY;
    for (const layer of layers) {
      let ancestor = layer.groupId;
      while (ancestor) {
        if (ancestor === groupId) {
          first = Math.min(first, layerOrder.get(layer.id)!);
          break;
        }
        ancestor = groupById.get(ancestor)?.parentGroupId ?? null;
      }
    }
    return first;
  };
  const renderChildren = (target: PixelBuffer, parentGroupId: string | null): void => {
    const children = [
      ...layers.filter((layer) => (layer.groupId ?? null) === parentGroupId)
        .map((layer) => ({ index: layerOrder.get(layer.id)!, layer })),
      ...groups.filter((group) => group.parentGroupId === parentGroupId)
        .map((group, index) => ({ index: firstLayerIndex(group.id) + index / (groups.length + 1), group })),
    ].sort((a, b) => a.index - b.index);
    let clipBaseAlpha: Uint8ClampedArray | null = null;
    let clipBaseVisible = false;
    let clipBaseOpacity = 1;
    for (const node of children) {
      if ('layer' in node) {
        const layer = node.layer;
        if (layer.visible) {
          const renderedLayer = getRenderedLayerBuffer(layer);
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const pixel = y * width + x;
              const sourceOffset = pixel * 4;
              const sourceAlpha = renderedLayer.data[sourceOffset + 3]!;
              if (sourceAlpha === 0 || layer.opacity === 0) continue;
              const effectiveAlpha = layer.clippingMask
                ? clipBaseAlpha && clipBaseVisible
                  ? Math.round((sourceAlpha * clipBaseAlpha[sourceOffset + 3]! * clipBaseOpacity) / 255)
                  : 0
                : sourceAlpha;
              if (effectiveAlpha === 0) continue;
              compositePixel(
                target.data,
                sourceOffset,
                renderedLayer.data,
                effectiveAlpha,
                layer.opacity,
                layer.blendMode,
                layer.effects ?? DEFAULT_LAYER_EFFECTS,
              );
            }
          }
        }
        if (!layer.clippingMask) {
          clipBaseAlpha = getRenderedLayerBuffer(layer).data;
          clipBaseVisible = layer.visible;
          clipBaseOpacity = layer.opacity;
        }
        continue;
      }
      const group = node.group;
      if (!group.visible || group.opacity === 0) continue;
      let groupBuffer = groupBuffers.get(group.id);
      if (!groupBuffer || groupBuffer.width !== width || groupBuffer.height !== height) {
        groupBuffer = new PixelBuffer(width, height);
        groupBuffers.set(group.id, groupBuffer);
      }
      for (let y = y0; y < y1; y++) {
        const start = (y * width + x0) * 4;
        groupBuffer.data.fill(0, start, start + updated.width * 4);
      }
      renderChildren(groupBuffer, group.id);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const offset = (y * width + x) * 4;
          const alpha = groupBuffer.data[offset + 3]!;
          if (!alpha) continue;
          compositePixel(target.data, offset, groupBuffer.data, alpha, group.opacity, group.blendMode, group.effects);
        }
      }
    }
  };
  renderChildren(output, null);
  output.markDirtyRect(updated.x, updated.y, updated.width, updated.height);
  return output;
}
