import { PixelBuffer, type RGBA } from './state';

export const MAX_LAYER_EFFECTS = 16;
export const MAX_EFFECT_RADIUS = 16;
export const MAX_EFFECT_OFFSET = 32;

export const LAYER_EFFECT_TYPES = [
  'outline',
  'drop-shadow',
  'glow',
  'gradient-map',
  'hue-shift',
  'brightness',
  'contrast',
  'posterize',
  'colorize',
  'noise',
  'pixelate',
  'blur',
  'sharpen',
] as const;

export type LayerEffectType = (typeof LAYER_EFFECT_TYPES)[number];
export type OutlinePlacement = 'outside' | 'inside' | 'center';

export interface LayerEffect {
  readonly id: string;
  readonly type: LayerEffectType;
  readonly enabled: boolean;
  readonly amount: number;
  readonly radius: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly levels: number;
  readonly size: number;
  readonly seed: number;
  readonly placement: OutlinePlacement;
  readonly color: RGBA;
  readonly secondaryColor: RGBA;
}

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 };
const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 255 };
const PURPLE: RGBA = { r: 124, g: 92, b: 255, a: 255 };

export function createLayerEffect(type: LayerEffectType, id: string): LayerEffect {
  let amount = 0;
  let radius = 1;
  let offsetX = 2;
  let offsetY = 2;
  let levels = 4;
  let size = 2;
  let color = BLACK;
  let secondaryColor = WHITE;
  let placement: OutlinePlacement = 'outside';

  switch (type) {
    case 'outline':
      amount = 100;
      break;
    case 'drop-shadow':
      amount = 60;
      radius = 2;
      break;
    case 'glow':
      amount = 75;
      radius = 3;
      color = PURPLE;
      break;
    case 'gradient-map':
      amount = 100;
      break;
    case 'hue-shift':
      color = PURPLE;
      break;
    case 'brightness':
    case 'contrast':
      break;
    case 'posterize':
      break;
    case 'colorize':
      amount = 50;
      color = PURPLE;
      break;
    case 'noise':
      amount = 10;
      break;
    case 'pixelate':
      size = 4;
      break;
    case 'blur':
      radius = 1;
      break;
    case 'sharpen':
      amount = 50;
      radius = 1;
      break;
  }

  return {
    id,
    type,
    enabled: true,
    amount,
    radius,
    offsetX,
    offsetY,
    levels,
    size,
    seed: 1,
    placement,
    color: { ...color },
    secondaryColor: { ...secondaryColor },
  };
}

function isColor(value: unknown): value is RGBA {
  if (typeof value !== 'object' || value === null) return false;
  const color = value as Record<string, unknown>;
  return ['r', 'g', 'b', 'a'].every((channel) =>
    Number.isInteger(color[channel]) && (color[channel] as number) >= 0 && (color[channel] as number) <= 255);
}

export function isValidLayerEffect(value: unknown): value is LayerEffect {
  if (typeof value !== 'object' || value === null) return false;
  const effect = value as Record<string, unknown>;
  if (
    typeof effect.id !== 'string' || effect.id.length === 0 || effect.id.length > 80 ||
    !LAYER_EFFECT_TYPES.includes(effect.type as LayerEffectType) ||
    typeof effect.enabled !== 'boolean' ||
    typeof effect.amount !== 'number' || !Number.isFinite(effect.amount) ||
    typeof effect.radius !== 'number' || !Number.isInteger(effect.radius) ||
    typeof effect.offsetX !== 'number' || !Number.isInteger(effect.offsetX) ||
    typeof effect.offsetY !== 'number' || !Number.isInteger(effect.offsetY) ||
    typeof effect.levels !== 'number' || !Number.isInteger(effect.levels) ||
    typeof effect.size !== 'number' || !Number.isInteger(effect.size) ||
    typeof effect.seed !== 'number' || !Number.isSafeInteger(effect.seed) ||
    !(effect.placement === 'outside' || effect.placement === 'inside' || effect.placement === 'center') ||
    !isColor(effect.color) || !isColor(effect.secondaryColor)
  ) return false;

  const type = effect.type as LayerEffectType;
  const amountValid = type === 'hue-shift'
    ? effect.amount >= -180 && effect.amount <= 180
    : type === 'brightness' || type === 'contrast'
      ? effect.amount >= -100 && effect.amount <= 100
      : effect.amount >= 0 && effect.amount <= 100;

  return amountValid &&
    effect.radius >= 0 && effect.radius <= MAX_EFFECT_RADIUS &&
    effect.offsetX >= -MAX_EFFECT_OFFSET && effect.offsetX <= MAX_EFFECT_OFFSET &&
    effect.offsetY >= -MAX_EFFECT_OFFSET && effect.offsetY <= MAX_EFFECT_OFFSET &&
    effect.levels >= 2 && effect.levels <= 32 &&
    effect.size >= 2 && effect.size <= 32 &&
    effect.seed >= 0 && effect.seed <= 0xffffffff;
}

export function isValidLayerEffectStack(value: unknown): value is readonly LayerEffect[] {
  if (!Array.isArray(value) || value.length > MAX_LAYER_EFFECTS) return false;
  const ids = new Set<string>();
  for (const effect of value) {
    if (!isValidLayerEffect(effect) || ids.has(effect.id)) return false;
    ids.add(effect.id);
  }
  return true;
}

export function layerEffectPadding(effects: readonly LayerEffect[]): number {
  let padding = 0;
  for (const effect of effects) {
    if (!effect.enabled) continue;
    switch (effect.type) {
      case 'outline':
      case 'glow':
      case 'blur':
      case 'sharpen':
        padding += effect.radius;
        break;
      case 'drop-shadow':
        padding += effect.radius + Math.max(Math.abs(effect.offsetX), Math.abs(effect.offsetY));
        break;
      case 'pixelate':
        padding += effect.size;
        break;
    }
  }
  return padding;
}

function colorOver(
  target: Uint8ClampedArray,
  offset: number,
  color: RGBA,
  alpha: number,
): void {
  const sa = Math.max(0, Math.min(1, alpha));
  if (sa === 0) return;
  const da = target[offset + 3]! / 255;
  const outA = sa + da * (1 - sa);
  if (outA === 0) return;
  for (let channel = 0; channel < 3; channel++) {
    const source = channel === 0 ? color.r : channel === 1 ? color.g : color.b;
    target[offset + channel] = Math.round((source * sa + target[offset + channel]! * da * (1 - sa)) / outA);
  }
  target[offset + 3] = Math.round(outA * 255);
}

function blurAlpha(alpha: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return alpha.slice();
  const horizontal = new Uint16Array(alpha.length);
  const result = new Uint8Array(alpha.length);
  const windowSize = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      const addX = x + radius;
      const removeX = x - radius - 1;
      if (addX < width) sum += alpha[y * width + addX]!;
      if (removeX >= 0) sum -= alpha[y * width + removeX]!;
      horizontal[y * width + x] = Math.round(sum / Math.min(width, windowSize));
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      const addY = y + radius;
      const removeY = y - radius - 1;
      if (addY < height) sum += horizontal[addY * width + x]!;
      if (removeY >= 0) sum -= horizontal[removeY * width + x]!;
      result[y * width + x] = Math.round(sum / Math.min(height, windowSize));
    }
  }
  return result;
}

function boxBlur(data: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  if (radius <= 0) return data.slice();
  const pixels = width * height;
  const horizontal = new Float32Array(pixels * 4);
  const output = new Uint8ClampedArray(data.length);
  const windowSize = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    const sums = [0, 0, 0, 0];
    for (let x = 0; x < width; x++) {
      const addX = x + radius;
      const removeX = x - radius - 1;
      if (addX < width) {
        const offset = (y * width + addX) * 4;
        const alpha = data[offset + 3]! / 255;
        sums[0]! += data[offset]! * alpha;
        sums[1]! += data[offset + 1]! * alpha;
        sums[2]! += data[offset + 2]! * alpha;
        sums[3]! += data[offset + 3]!;
      }
      if (removeX >= 0) {
        const offset = (y * width + removeX) * 4;
        const alpha = data[offset + 3]! / 255;
        sums[0]! -= data[offset]! * alpha;
        sums[1]! -= data[offset + 1]! * alpha;
        sums[2]! -= data[offset + 2]! * alpha;
        sums[3]! -= data[offset + 3]!;
      }
      const count = Math.min(width, windowSize);
      const target = (y * width + x) * 4;
      horizontal[target] = sums[0]! / count;
      horizontal[target + 1] = sums[1]! / count;
      horizontal[target + 2] = sums[2]! / count;
      horizontal[target + 3] = sums[3]! / count;
    }
  }

  for (let x = 0; x < width; x++) {
    const sums = [0, 0, 0, 0];
    for (let y = 0; y < height; y++) {
      const addY = y + radius;
      const removeY = y - radius - 1;
      if (addY < height) {
        const offset = (addY * width + x) * 4;
        sums[0]! += horizontal[offset]!;
        sums[1]! += horizontal[offset + 1]!;
        sums[2]! += horizontal[offset + 2]!;
        sums[3]! += horizontal[offset + 3]!;
      }
      if (removeY >= 0) {
        const offset = (removeY * width + x) * 4;
        sums[0]! -= horizontal[offset]!;
        sums[1]! -= horizontal[offset + 1]!;
        sums[2]! -= horizontal[offset + 2]!;
        sums[3]! -= horizontal[offset + 3]!;
      }
      const count = Math.min(height, windowSize);
      const target = (y * width + x) * 4;
      const alpha = sums[3]! / count;
      output[target + 3] = Math.round(alpha);
      if (alpha > 0) {
        output[target] = Math.round(sums[0]! * 255 / alpha / count);
        output[target + 1] = Math.round(sums[1]! * 255 / alpha / count);
        output[target + 2] = Math.round(sums[2]! * 255 / alpha / count);
      }
    }
  }
  return output;
}

function applyOutline(data: Uint8ClampedArray, width: number, height: number, effect: LayerEffect): Uint8ClampedArray {
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
  const radius = Math.max(1, effect.radius);
  const morph = (source: Uint8Array, maximum: boolean): Uint8Array => {
    const horizontal = new Uint8Array(source.length);
    const result = new Uint8Array(source.length);
    const line = (input: Uint8Array, output: Uint8Array, length: number, inputStride: number, outputStride: number) => {
      const queue = new Int32Array(length);
      let head = 0;
      let tail = 0;
      let next = 0;
      for (let position = 0; position < length; position++) {
        const last = Math.min(length - 1, position + radius);
        while (next <= last) {
          const value = input[next * inputStride]!;
          while (tail > head) {
            const previous = input[queue[tail - 1]! * inputStride]!;
            if (maximum ? previous > value : previous < value) break;
            tail--;
          }
          queue[tail++] = next++;
        }
        const first = position - radius;
        while (tail > head && queue[head]! < first) head++;
        output[position * outputStride] = input[queue[head]! * inputStride]!;
      }
    };
    for (let y = 0; y < height; y++) {
      const row = y * width;
      line(source.subarray(row), horizontal.subarray(row), width, 1, 1);
    }
    const column = new Uint8Array(height);
    const filteredColumn = new Uint8Array(height);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) column[y] = horizontal[y * width + x]!;
      line(column, filteredColumn, height, 1, 1);
      for (let y = 0; y < height; y++) result[y * width + x] = filteredColumn[y]!;
    }
    return result;
  };
  const dilated = morph(alpha, true);
  const eroded = morph(alpha, false);

  const output = data.slice();
  const intensity = effect.amount / 100;
  for (let i = 0; i < alpha.length; i++) {
    const sourceAlpha = alpha[i]!;
    if (effect.placement !== 'inside' && sourceAlpha === 0) {
      colorOver(output, i * 4, effect.color, (dilated[i]! / 255) * (effect.color.a / 255) * intensity);
    } else if (effect.placement !== 'outside' && sourceAlpha > 0 && eroded[i]! < sourceAlpha) {
      const offset = i * 4;
      const strength = intensity * effect.color.a / 255;
      output[offset] = data[offset]! + (effect.color.r - data[offset]!) * strength;
      output[offset + 1] = data[offset + 1]! + (effect.color.g - data[offset + 1]!) * strength;
      output[offset + 2] = data[offset + 2]! + (effect.color.b - data[offset + 2]!) * strength;
    }
  }
  return output;
}

function applyShadow(data: Uint8ClampedArray, width: number, height: number, effect: LayerEffect, glow: boolean): Uint8ClampedArray {
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
  let shadowAlpha: Uint8Array;
  if (glow) {
    shadowAlpha = blurAlpha(alpha, width, height, Math.max(1, effect.radius));
  } else {
    const shifted = new Uint8Array(alpha.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sourceX = x - effect.offsetX;
        const sourceY = y - effect.offsetY;
        if (sourceX >= 0 && sourceY >= 0 && sourceX < width && sourceY < height) {
          shifted[y * width + x] = alpha[sourceY * width + sourceX]!;
        }
      }
    }
    shadowAlpha = blurAlpha(shifted, width, height, effect.radius);
  }

  const output = new Uint8ClampedArray(data.length);
  const strength = effect.amount / 100;
  for (let i = 0; i < alpha.length; i++) {
    const offset = i * 4;
    const coverage = (shadowAlpha[i]! / 255) * (effect.color.a / 255) * strength;
    colorOver(output, offset, effect.color, coverage);
    if (data[offset + 3] !== 0) {
      colorOver(output, offset, {
        r: data[offset]!,
        g: data[offset + 1]!,
        b: data[offset + 2]!,
        a: data[offset + 3]!,
      }, data[offset + 3]! / 255);
    }
  }
  return output;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
  }
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return [(hue + 360) % 360, saturation, lightness];
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const h = ((hue % 360) + 360) % 360 / 60;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  let rgb: [number, number, number];
  if (h < 1) rgb = [chroma, x, 0];
  else if (h < 2) rgb = [x, chroma, 0];
  else if (h < 3) rgb = [0, chroma, x];
  else if (h < 4) rgb = [0, x, chroma];
  else if (h < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  const match = lightness - chroma / 2;
  return rgb.map((channel) => Math.round((channel + match) * 255)) as [number, number, number];
}

function applyColorFilter(data: Uint8ClampedArray, effect: LayerEffect): Uint8ClampedArray {
  const output = data.slice();
  const type = effect.type;
  const contrastFactor = (259 * (effect.amount + 255)) / (255 * (259 - effect.amount));
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    let r = data[offset]!;
    let g = data[offset + 1]!;
    let b = data[offset + 2]!;
    if (type === 'hue-shift') {
      const [hue, saturation, lightness] = rgbToHsl(r, g, b);
      [r, g, b] = hslToRgb(hue + effect.amount, saturation, lightness);
    } else if (type === 'brightness') {
      r += effect.amount * 2.55;
      g += effect.amount * 2.55;
      b += effect.amount * 2.55;
    } else if (type === 'contrast') {
      r = contrastFactor * (r - 128) + 128;
      g = contrastFactor * (g - 128) + 128;
      b = contrastFactor * (b - 128) + 128;
    } else if (type === 'posterize') {
      const levels = effect.levels - 1;
      r = Math.round(r / 255 * levels) * 255 / levels;
      g = Math.round(g / 255 * levels) * 255 / levels;
      b = Math.round(b / 255 * levels) * 255 / levels;
    } else if (type === 'gradient-map') {
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const mapped = [
        effect.color.r + (effect.secondaryColor.r - effect.color.r) * luminance,
        effect.color.g + (effect.secondaryColor.g - effect.color.g) * luminance,
        effect.color.b + (effect.secondaryColor.b - effect.color.b) * luminance,
      ];
      const amount = effect.amount / 100;
      r += (mapped[0]! - r) * amount;
      g += (mapped[1]! - g) * amount;
      b += (mapped[2]! - b) * amount;
    } else if (type === 'colorize') {
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const amount = effect.amount / 100;
      r += (effect.color.r * luminance - r) * amount;
      g += (effect.color.g * luminance - g) * amount;
      b += (effect.color.b * luminance - b) * amount;
    } else if (type === 'noise') {
      const seed = (effect.seed + offset / 4) >>> 0;
      const noise = (channel: number) => {
        let value = (seed ^ Math.imul(channel + 1, 0x9e3779b1)) >>> 0;
        value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
        value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
        value = (value ^ (value >>> 16)) >>> 0;
        return (value / 0xffffffff * 2 - 1) * effect.amount * 1.275;
      };
      r += noise(0);
      g += noise(1);
      b += noise(2);
    }
    output[offset] = r;
    output[offset + 1] = g;
    output[offset + 2] = b;
  }
  return output;
}

function applyPixelate(data: Uint8ClampedArray, width: number, height: number, size: number): Uint8ClampedArray {
  const output = data.slice();
  for (let top = 0; top < height; top += size) {
    for (let left = 0; left < width; left += size) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;
      const right = Math.min(width, left + size);
      const bottom = Math.min(height, top + size);
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const offset = (y * width + x) * 4;
          const a = data[offset + 3]! / 255;
          red += data[offset]! * a;
          green += data[offset + 1]! * a;
          blue += data[offset + 2]! * a;
          alpha += data[offset + 3]!;
          count++;
        }
      }
      const averageAlpha = alpha / count;
      const color = averageAlpha === 0 ? [0, 0, 0] : [
        red * 255 / alpha,
        green * 255 / alpha,
        blue * 255 / alpha,
      ];
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const offset = (y * width + x) * 4;
          output[offset] = color[0]!;
          output[offset + 1] = color[1]!;
          output[offset + 2] = color[2]!;
          output[offset + 3] = averageAlpha;
        }
      }
    }
  }
  return output;
}

function applySharpen(data: Uint8ClampedArray, width: number, height: number, effect: LayerEffect): Uint8ClampedArray {
  const blurred = boxBlur(data, width, height, Math.max(1, effect.radius));
  const output = data.slice();
  const strength = effect.amount / 100;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    for (let channel = 0; channel < 3; channel++) {
      output[offset + channel] = data[offset + channel]! +
        (data[offset + channel]! - blurred[offset + channel]!) * strength;
    }
  }
  return output;
}

function applyEffect(data: Uint8ClampedArray, width: number, height: number, effect: LayerEffect): Uint8ClampedArray {
  switch (effect.type) {
    case 'outline': return applyOutline(data, width, height, effect);
    case 'drop-shadow': return applyShadow(data, width, height, effect, false);
    case 'glow': return applyShadow(data, width, height, effect, true);
    case 'hue-shift':
    case 'brightness':
    case 'contrast':
    case 'posterize':
    case 'gradient-map':
    case 'colorize':
    case 'noise': return applyColorFilter(data, effect);
    case 'pixelate': return applyPixelate(data, width, height, effect.size);
    case 'blur': return boxBlur(data, width, height, Math.max(1, effect.radius));
    case 'sharpen': return applySharpen(data, width, height, effect);
  }
}

export function applyLayerEffectStack(source: PixelBuffer, effects: readonly LayerEffect[]): PixelBuffer {
  if (!isValidLayerEffectStack(effects)) throw new RangeError('Layer effect stack is invalid.');
  let data = source.data.slice();
  for (const effect of effects) {
    if (!effect.enabled) continue;
    data = applyEffect(data, source.width, source.height, effect);
  }
  return new PixelBuffer(source.width, source.height, data);
}
