import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeRasterImage, fitImageDimensions, rasterImageToProject } from './imageImport';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('импорт растровых изображений', () => {
  it('сохраняет исходные размеры и пропорции без масштабирования', () => {
    expect(fitImageDimensions(96, 64)).toEqual({ width: 96, height: 64 });
    expect(fitImageDimensions(1024, 512)).toEqual({ width: 1024, height: 512 });
    expect(fitImageDimensions(512, 1024)).toEqual({ width: 512, height: 1024 });
  });

  it('отвергает нулевые и нецелочисленные размеры изображения', () => {
    expect(() => fitImageDimensions(0, 10)).toThrow();
    expect(() => fitImageDimensions(10.5, 10)).toThrow();
  });

  it('импортирует изображение в исходном разрешении без масштабирования', async () => {
    const drawImage = vi.fn();
    const close = vi.fn();
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      clearRect: vi.fn(),
      drawImage,
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(1024 * 512 * 4) })),
    };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1024, height: 512, close })));
    vi.stubGlobal(
      'document',
      { createElement: vi.fn(() => ({ getContext: vi.fn(() => context), width: 0, height: 0 })) },
    );

    const image = await decodeRasterImage(new File(['image'], 'art.png'));

    expect(image).toMatchObject({ width: 1024, height: 512 });
    expect(context.imageSmoothingEnabled).toBe(true);
    expect(context.imageSmoothingQuality).toBe('high');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1024, 512);
    expect(close).toHaveBeenCalledOnce();
  });

  it('сообщает этапы декодирования и подготовки пикселей', async () => {
    const close = vi.fn();
    const progress: string[] = [];
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close })));
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ getContext: vi.fn(() => context), width: 0, height: 0 })),
    });

    await decodeRasterImage(new File(['image'], 'progress.png'), {
      onProgress: (stage) => progress.push(stage),
    });

    expect(progress).toEqual(['decoding', 'rasterizing', 'complete']);
  });

  it('вписывает изображение в выбранный холст по центру без обрезки и искажений', async () => {
    const drawImage = vi.fn();
    const close = vi.fn();
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      clearRect: vi.fn(),
      drawImage,
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(32 * 32 * 4) })),
    };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 128, height: 64, close })));
    vi.stubGlobal(
      'document',
      { createElement: vi.fn(() => ({ getContext: vi.fn(() => context), width: 0, height: 0 })) },
    );

    const image = await decodeRasterImage(new File(['image'], 'photo.jpg'), {
      fitWithin: { width: 32, height: 32 },
    });

    expect(image).toMatchObject({ width: 32, height: 32 });
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 32, 32);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 8, 32, 16);
    expect(close).toHaveBeenCalledOnce();
  });

  it('проверяет дополнительный лимит пикселей до выделения canvas и закрывает bitmap', async () => {
    const close = vi.fn();
    const getImageData = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2, height: 2, close })));
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ getContext: vi.fn(() => ({ getImageData })) })),
    });

    await expect(decodeRasterImage(new File(['image'], 'ref.png'), { maxPixels: 3 }))
      .rejects.toThrow(/лимит пикселей/i);
    expect(getImageData).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('отклоняет изображения, превышающие безопасный размер холста, вместо их обрезки', () => {
    expect(() => fitImageDimensions(3000, 2000)).toThrow(/слишком велико для холста/);
  });

  it('сохраняет исходные цвета растра независимо от выбранной палитры', () => {
    const image = { width: 2, height: 1, pixels: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 0]) };
    const recent = [{ r: 4, g: 5, b: 6, a: 255 }];
    const project = rasterImageToProject(image, {
      paletteId: 'pico8',
      freeColor: false,
      primary: { r: 10, g: 20, b: 30, a: 255 },
      secondary: { r: 30, g: 20, b: 10, a: 255 },
      recent,
    });

    expect(project).toMatchObject({ width: 2, height: 1, paletteId: 'pico8', freeColor: false });
    expect(project.pixels).toBe(image.pixels);
    expect(project.recent).toEqual(recent);
    expect(project.recent).not.toBe(recent);
  });
});
