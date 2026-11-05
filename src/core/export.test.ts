import { describe, expect, it } from 'vitest';
import { getAvailableExportScales, isExportSizeAllowed, MAX_EXPORT_PIXELS, scaleNearest } from './export';
import { adler32, crc32, encodePng, zlibStored } from './png';
import { PixelBuffer } from './state';

const RED = { r: 255, g: 0, b: 0, a: 255 };

describe('масштабирование', () => {
  const b = new PixelBuffer(3, 2);
  b.setPixel(0, 0, RED);
  b.setPixel(2, 1, { r: 10, g: 20, b: 30, a: 128 });

  it.each([1, 4, 8, 16])('×%i: каждый пиксель — квадрат, цвета и альфа не смешиваются', (s) => {
    const img = scaleNearest(b, s);
    expect(img.width).toBe(3 * s);
    expect(img.height).toBe(2 * s);
    for (let y = 0; y < 2 * s; y++) {
      for (let x = 0; x < 3 * s; x++) {
        const src = b.getPixel(Math.floor(x / s), Math.floor(y / s))!;
        const o = (y * img.width + x) * 4;
        expect(Array.from(img.data.slice(o, o + 4))).toEqual([src.r, src.g, src.b, src.a]);
      }
    }
  });

  it('×1 совпадает с исходником, неверный масштаб отвергается', () => {
    expect(Array.from(scaleNearest(b, 1).data)).toEqual(Array.from(b.data));
    expect(() => scaleNearest(b, 0)).toThrow();
    expect(() => scaleNearest(b, 2.5)).toThrow();
  });

  it('ограничивает масштабирование до безопасного экспорта на 16 млн пикселей', () => {
    expect(MAX_EXPORT_PIXELS).toBe(16_000_000);
    expect(isExportSizeAllowed(1000, 1000, 4)).toBe(true);
    expect(isExportSizeAllowed(1024, 1024, 8)).toBe(false);
    expect(getAvailableExportScales(4096, 1024)).toEqual([1]);
    expect(() => scaleNearest(new PixelBuffer(1024, 1024), 8)).toThrow(/превышает лимит/);
    expect(() => scaleNearest(new PixelBuffer(1000, 1000), 4)).not.toThrow();
  });
});

/** Разбирает PNG: проверяет подпись и CRC каждого блока, распаковывает IDAT и снимает фильтр 0. */
async function decodePng(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  const types: string[] = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    types.push(type);
    expect(view.getUint32(offset + 8 + length)).toBe(crc32(bytes, offset + 4, offset + 8 + length));
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      expect(Array.from(bytes.slice(offset + 16, offset + 21))).toEqual([8, 6, 0, 0, 0]);
    }
    if (type === 'IDAT') idat.push(bytes.slice(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);

  const compressed = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const part of idat) {
    compressed.set(part, o);
    o += part.length;
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  const stride = width * 4;
  expect(raw.length).toBe((stride + 1) * height);
  const pixels = new Uint8ClampedArray(stride * height);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (stride + 1)]).toBe(0);
    pixels.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width, height, pixels };
}

describe('PNG', () => {
  it('контрольные суммы совпадают с эталонными значениями', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(adler32(new TextEncoder().encode('Wikipedia'))).toBe(0x11e60398);
  });

  it('BUG-C: полупрозрачные пиксели записываются без искажений (чего не делает canvas)', async () => {
    const b = new PixelBuffer(4, 4);
    b.setPixel(0, 0, { r: 200, g: 100, b: 50, a: 4 });
    b.setPixel(1, 0, { r: 200, g: 100, b: 50, a: 1 });
    b.setPixel(2, 0, { r: 255, g: 255, b: 255, a: 128 });
    b.setPixel(3, 3, RED);
    const png = await encodePng(scaleNearest(b, 1));
    const decoded = await decodePng(png);
    expect(Array.from(decoded.pixels)).toEqual(Array.from(b.data));
    expect(Array.from(decoded.pixels.slice(0, 4))).toEqual([200, 100, 50, 4]);
  });

  it.each([1, 4, 8, 16])('×%i: размер и каждый пиксель совпадают, прозрачность сохранена', async (scale) => {
    const b = new PixelBuffer(7, 5);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) if ((x + y) % 3) b.setPixel(x, y, { r: x * 30, g: y * 40, b: 99, a: 1 + ((x * 37 + y * 11) % 255) });
    const image = scaleNearest(b, scale);
    const decoded = await decodePng(await encodePng(image));
    expect(decoded.width).toBe(7 * scale);
    expect(decoded.height).toBe(5 * scale);
    expect(Array.from(decoded.pixels)).toEqual(Array.from(image.data));
  });

  it('режим без сжатия (запасной) даёт валидный PNG, в том числе больше 64 КБ данных', async () => {
    const b = new PixelBuffer(100, 100);
    for (let i = 0; i < 100; i++) b.setPixel(i, i, { r: i, g: 2 * i, b: 3, a: 255 });
    const image = scaleNearest(b, 1);
    const png = await encodePng(image, { stored: true });
    expect(png.length).toBeGreaterThan(40_000);
    expect(Array.from((await decodePng(png)).pixels)).toEqual(Array.from(image.data));
    expect(zlibStored(new Uint8Array(0)).length).toBe(2 + 5 + 4);
  });

  it('сжатие реально уменьшает типичный рисунок', async () => {
    const b = new PixelBuffer(64, 64);
    b.setPixel(10, 10, RED);
    const image = scaleNearest(b, 8);
    const png = await encodePng(image);
    expect(png.length).toBeLessThan(image.data.length / 50);
  });

  it('отвергает неверные размеры', async () => {
    await expect(encodePng({ width: 0, height: 1, data: new Uint8ClampedArray(0) })).rejects.toThrow();
    await expect(encodePng({ width: 2, height: 2, data: new Uint8ClampedArray(4) })).rejects.toThrow();
  });
});
