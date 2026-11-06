import { DEFAULT_PALETTE_ID } from './palette';
import type { Palette } from './palette';
import type { ProjectData } from './project';
import { isValidCanvasSize } from './state';

export const MAX_IMAGE_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_DECODED_IMAGE_PIXELS = 32_000_000;

export interface DecodedRasterImage {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export interface RasterImportOptions {
  paletteId: string;
  freeColor: boolean;
  primary: ProjectData['primary'];
  secondary: ProjectData['secondary'];
  recent: ProjectData['recent'];
  customPalettes?: Palette[];
}

interface DecodedImageSource {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

export function fitImageDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('Изображение имеет недопустимый размер.');
  }
  if (!isValidCanvasSize(width, height)) {
    throw new RangeError('Изображение слишком велико для холста: максимальная сторона — 4096 пикселей, площадь — 4 194 304 пикселя.');
  }
  return { width, height };
}

function assertImageFile(file: File): void {
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new RangeError(`Файл изображения превышает допустимый размер ${MAX_IMAGE_FILE_BYTES / 1024 / 1024} МБ.`);
  }
  if (file.size === 0) throw new TypeError('Файл изображения пуст.');
}

async function decodeBitmap(file: File): Promise<DecodedImageSource> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }

  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('Этот браузер не поддерживает чтение изображений.');
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => URL.revokeObjectURL(url),
  };
}

export async function decodeRasterImage(
  file: File,
  options: { maxPixels?: number } = {},
): Promise<DecodedRasterImage> {
  assertImageFile(file);
  const maxPixels = options.maxPixels ?? MAX_DECODED_IMAGE_PIXELS;
  if (!Number.isSafeInteger(maxPixels) || maxPixels < 1) {
    throw new RangeError('Недопустимый лимит пикселей изображения.');
  }
  const bitmap = await decodeBitmap(file);

  try {
    const pixelCount = bitmap.width * bitmap.height;
    if (pixelCount > maxPixels && options.maxPixels !== undefined) {
      throw new RangeError(
        `Изображение превышает доступный лимит пикселей (${maxPixels.toLocaleString('ru-RU')}).`,
      );
    }
    if (pixelCount > MAX_DECODED_IMAGE_PIXELS) {
      throw new RangeError('Изображение слишком большое для безопасной обработки.');
    }

    const { width, height } = fitImageDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Не удалось создать временный холст для чтения изображения.');

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap.source, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    return { width, height, pixels: image.data };
  } finally {
    bitmap.close();
  }
}

export function rasterImageToProject(image: DecodedRasterImage, options: RasterImportOptions): ProjectData {
  return {
    width: image.width,
    height: image.height,
    pixels: image.pixels,
    paletteId: options.paletteId || DEFAULT_PALETTE_ID,
    freeColor: options.freeColor,
    primary: options.primary,
    secondary: options.secondary,
    recent: [...options.recent],
    ...(options.customPalettes?.length ? { customPalettes: options.customPalettes } : {}),
  };
}
