import { describe, expect, it } from 'vitest';
import {
  applyLayerEffectStack,
  createLayerEffect,
  isValidLayerEffectStack,
  type LayerEffectType,
} from './effects';
import { PixelBuffer } from './state';

const TYPES: readonly LayerEffectType[] = [
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
];

function sample(): PixelBuffer {
  const buffer = new PixelBuffer(8, 8);
  for (let y = 2; y < 6; y++) {
    for (let x = 2; x < 6; x++) {
      buffer.setPixel(x, y, {
        r: x * 25 + y * 7,
        g: x * 11 + y * 19,
        b: x * 17 + y * 13,
        a: 255,
      });
    }
  }
  return buffer;
}

describe('non-destructive layer effects', () => {
  it('renders every supported effect without changing source pixels', () => {
    for (const [index, type] of TYPES.entries()) {
      const source = sample();
      const original = source.data.slice();
      const base = createLayerEffect(type, `effect-${index}`);
      const effect = type === 'hue-shift'
        ? { ...base, amount: 120 }
        : type === 'brightness'
          ? { ...base, amount: 25 }
          : type === 'contrast'
            ? { ...base, amount: 40 }
            : base;
      const effected = applyLayerEffectStack(source, [effect]);
      expect(effected.data).not.toEqual(original);
      expect(source.data).toEqual(original);
    }
  });

  it('provides deterministic noise and can disable or remove a filter without losing source data', () => {
    const source = sample();
    const original = source.data.slice();
    const noise = { ...createLayerEffect('noise', 'noise'), amount: 80, seed: 912 };
    const first = applyLayerEffectStack(source, [noise]);
    const second = applyLayerEffectStack(source, [noise]);
    expect(first.data).toEqual(second.data);
    expect(applyLayerEffectStack(source, [{ ...noise, enabled: false }]).data).toEqual(original);
    expect(applyLayerEffectStack(source, []).data).toEqual(original);
    expect(source.data).toEqual(original);
  });

  it('adds an outside outline and a shifted shadow beyond the original silhouette', () => {
    const source = new PixelBuffer(7, 7);
    source.setPixel(3, 3, { r: 255, g: 255, b: 255, a: 255 });
    const outline = {
      ...createLayerEffect('outline', 'outline'),
      color: { r: 255, g: 0, b: 0, a: 255 },
      radius: 1,
    };
    const outlined = applyLayerEffectStack(source, [outline]);
    expect(outlined.getPixel(2, 3)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(outlined.getPixel(3, 3)).toEqual({ r: 255, g: 255, b: 255, a: 255 });

    const shadow = {
      ...createLayerEffect('drop-shadow', 'shadow'),
      amount: 100,
      radius: 0,
      offsetX: 1,
      offsetY: 0,
    };
    const shadowed = applyLayerEffectStack(source, [shadow]);
    expect(shadowed.getPixel(4, 3)?.a).toBe(255);
    expect(source.getPixel(4, 3)?.a).toBe(0);
  });

  it('validates effect identifiers, parameters, and stack size', () => {
    const effect = createLayerEffect('blur', 'blur');
    expect(isValidLayerEffectStack([effect])).toBe(true);
    expect(isValidLayerEffectStack([{ ...effect, radius: 100 }])).toBe(false);
    expect(isValidLayerEffectStack([effect, effect])).toBe(false);
    expect(isValidLayerEffectStack(Array.from({ length: 17 }, (_, index) =>
      createLayerEffect('brightness', `brightness-${index}`)))).toBe(false);
  });
});
