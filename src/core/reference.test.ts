import { describe, expect, it } from 'vitest';
import { PixelBuffer } from './state';
import { applyReferencesToBuffer, referenceAtPoint, sampleReferenceColor, type ReferenceImage } from './reference';

function reference(overrides: Partial<ReferenceImage> = {}): ReferenceImage {
  return {
    id: 'ref',
    name: 'sample.png',
    width: 2,
    height: 1,
    pixels: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]),
    x: 10,
    y: 20,
    scale: 1,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    ...overrides,
  };
}

describe('референсы', () => {
  it('сэмплирует исходный пиксель с учётом позиции и масштаба', () => {
    const image = reference({ scale: 2 });
    expect(sampleReferenceColor(image, 10.5, 20.5)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(sampleReferenceColor(image, 12.5, 20.5)).toEqual({ r: 0, g: 255, b: 0, a: 128 });
    expect(sampleReferenceColor(image, 14.1, 20.5)).toBeNull();
  });

  it('обращает поворот вокруг центра изображения при выборке цвета', () => {
    const image = reference({ rotation: 90 });
    expect(sampleReferenceColor(image, 11, 20.1)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(sampleReferenceColor(image, 11, 20.9)).toEqual({ r: 0, g: 255, b: 0, a: 128 });
    expect(sampleReferenceColor(image, 10, 20)).toBeNull();
  });

  it('выбирает самый верхний видимый референс и пропускает скрытые', () => {
    const bottom = reference();
    const top = reference({
      id: 'top',
      visible: false,
      pixels: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]),
    });
    expect(referenceAtPoint([bottom, top], 10.5, 20.5)?.id).toBe('ref');
    top.visible = true;
    expect(referenceAtPoint([bottom, top], 10.5, 20.5)?.id).toBe('top');
  });

  it('композитит референсы в буфер только для явно запрошенного экспорта', () => {
    const target = new PixelBuffer(2, 1);
    const source = reference({
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray([200, 100, 50, 255]),
      x: 0,
      y: 0,
      opacity: 0.5,
    });
    applyReferencesToBuffer(target, 0, 0, [source]);
    expect(Array.from(target.data.slice(0, 4))).toEqual([200, 100, 50, 128]);
    expect(Array.from(target.data.slice(4, 8))).toEqual([0, 0, 0, 0]);

    const hiddenTarget = new PixelBuffer(2, 1);
    applyReferencesToBuffer(hiddenTarget, 0, 0, [{ ...source, visible: false }]);
    expect(Array.from(hiddenTarget.data)).toEqual(new Array(8).fill(0));
  });
});
