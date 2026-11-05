import { describe, expect, it } from 'vitest';
import { isValidCanvasSize, PixelBuffer, normalizeTransparent } from './state';

const RED = { r: 255, g: 0, b: 0, a: 255 };

describe('размеры холста', () => {
  it('разрешает исходные изображения в пределах лимитов площади и стороны', () => {
    expect(isValidCanvasSize(1024, 1024)).toBe(true);
    expect(isValidCanvasSize(4096, 1024)).toBe(true);
    expect(isValidCanvasSize(4096, 1025)).toBe(false);
    expect(isValidCanvasSize(4097, 1)).toBe(false);
    expect(() => new PixelBuffer(3000, 2000)).toThrow(/Недопустимый размер сетки/);
  });
});

describe('PixelBuffer: грязная область', () => {
  it('новый буфер целиком грязный, takeDirty сбрасывает область', () => {
    const b = new PixelBuffer(8, 6);
    expect(b.takeDirty()).toEqual({ x: 0, y: 0, width: 8, height: 6 });
    expect(b.isDirty).toBe(false);
    expect(b.takeDirty()).toBeNull();
  });

  it('setPixel расширяет область до объединения изменённых пикселей', () => {
    const b = new PixelBuffer(16, 16);
    b.takeDirty();
    b.setPixel(3, 4, RED);
    expect(b.takeDirty()).toEqual({ x: 3, y: 4, width: 1, height: 1 });
    b.setPixel(3, 4, RED);
    b.setPixel(9, 2, RED);
    b.setPixel(5, 12, RED);
    expect(b.takeDirty()).toEqual({ x: 3, y: 2, width: 7, height: 11 });
  });

  it('запись вне холста область не меняет', () => {
    const b = new PixelBuffer(8, 8);
    b.takeDirty();
    expect(b.setPixel(-1, 3, RED)).toBe(false);
    expect(b.setPixel(3, 8, RED)).toBe(false);
    expect(b.isDirty).toBe(false);
  });

  it('markDirtyRect отсекает всё за границами холста', () => {
    const b = new PixelBuffer(10, 10);
    b.takeDirty();
    b.markDirtyRect(-5, -5, 7, 7);
    expect(b.takeDirty()).toEqual({ x: 0, y: 0, width: 2, height: 2 });
    b.markDirtyRect(8, 8, 10, 10);
    expect(b.takeDirty()).toEqual({ x: 8, y: 8, width: 2, height: 2 });
    b.markDirtyRect(20, 20, 3, 3);
    expect(b.isDirty).toBe(false);
  });

  it('resized и clone возвращают полностью грязные буферы', () => {
    const b = new PixelBuffer(8, 8);
    b.takeDirty();
    expect(b.resized(4, 4).takeDirty()).toEqual({ x: 0, y: 0, width: 4, height: 4 });
    expect(b.clone().takeDirty()).toEqual({ x: 0, y: 0, width: 8, height: 8 });
  });
});

describe('PixelBuffer: прозрачность', () => {
  it('прозрачный цвет всегда пишется как (0,0,0,0)', () => {
    const b = new PixelBuffer(4, 4);
    b.setPixel(1, 1, RED);
    b.setPixel(1, 1, { r: 9, g: 9, b: 9, a: 0 });
    expect(b.getPixel(1, 1)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('normalizeTransparent чистит спрятанный RGB и не трогает видимые пиксели', () => {
    const data = new Uint8ClampedArray([9, 9, 9, 0, 1, 2, 3, 4, 0, 0, 0, 0]);
    expect(normalizeTransparent(data)).toBe(1);
    expect(Array.from(data)).toEqual([0, 0, 0, 0, 1, 2, 3, 4, 0, 0, 0, 0]);
  });
});
