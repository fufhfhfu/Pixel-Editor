import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PixelRenderer } from './render';
import { PixelBuffer } from './state';

const RED = { r: 255, g: 0, b: 0, a: 255 };

interface PutCall {
  dx: number;
  dy: number;
  dirty: [number, number, number, number];
  firstPixelRed: number;
}

/** Минимальные заглушки canvas и ImageData: достаточно, чтобы проверить, что и куда выводится. */
function makeCanvas() {
  const calls: PutCall[] = [];
  const ctx = {
    putImageData(image: { data: Uint8ClampedArray }, dx: number, dy: number, x: number, y: number, w: number, h: number) {
      calls.push({ dx, dy, dirty: [x, y, w, h], firstPixelRed: image.data[0] });
    },
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

const globalWithImageData = globalThis as unknown as { ImageData?: unknown };
const original = globalWithImageData.ImageData;

describe('PixelRenderer', () => {
  beforeEach(() => {
    globalWithImageData.ImageData = class {
      data: Uint8ClampedArray;
      constructor(data: Uint8ClampedArray, public width: number, public height: number) {
        this.data = data; // память делится с буфером
      }
    };
  });
  afterEach(() => {
    globalWithImageData.ImageData = original;
  });

  it('первая отрисовка — весь холст, canvas получает размер буфера', () => {
    const { canvas, calls } = makeCanvas();
    const r = new PixelRenderer(canvas);
    r.attach(new PixelBuffer(64, 32));
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(32);
    expect(r.render()).toEqual({ x: 0, y: 0, width: 64, height: 32 });
    expect(calls[0].dirty).toEqual([0, 0, 64, 32]);
  });

  it('дальше выводится только изменённый прямоугольник; без изменений — ничего', () => {
    const { canvas, calls } = makeCanvas();
    const r = new PixelRenderer(canvas);
    const b = new PixelBuffer(64, 64);
    r.attach(b);
    r.render();
    expect(r.render()).toBeNull();

    b.setPixel(10, 20, RED);
    b.setPixel(12, 21, RED);
    expect(r.render()).toEqual({ x: 10, y: 20, width: 3, height: 2 });
    expect(calls.at(-1)).toMatchObject({ dx: 0, dy: 0, dirty: [10, 20, 3, 2] });
    expect(calls).toHaveLength(2);
  });

  it('смена буфера того же размера не очищает canvas, но перерисовывает всё', () => {
    const { canvas, calls } = makeCanvas();
    const r = new PixelRenderer(canvas);
    r.attach(new PixelBuffer(16, 16));
    r.render();
    canvas.width = 16; // метка: если рендерер присвоит width, canvas «очистится»
    let cleared = false;
    Object.defineProperty(canvas, 'width', { get: () => 16, set: () => (cleared = true) });
    r.attach(new PixelBuffer(16, 16));
    expect(cleared).toBe(false);
    r.render();
    expect(calls.at(-1)?.dirty).toEqual([0, 0, 16, 16]);
  });

  it('если ImageData скопировал данные, перед выводом копируется только грязная область', () => {
    globalWithImageData.ImageData = class {
      data: Uint8ClampedArray;
      constructor(data: Uint8ClampedArray, public width: number, public height: number) {
        this.data = data.slice(); // реализация с копированием
      }
    };
    const { canvas, calls } = makeCanvas();
    const r = new PixelRenderer(canvas);
    const b = new PixelBuffer(8, 8);
    r.attach(b);
    r.render();
    b.setPixel(0, 0, RED);
    r.render();
    expect(calls.at(-1)?.firstPixelRed).toBe(255);
  });
});
