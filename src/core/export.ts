/**
 * Ядро: экспорт изображения.
 * scaleNearest и кодирование PNG — чистые функции; Blob использует DOM.
 */

import { encodePngWithWorker } from './pngWorker';
import type { PixelBuffer } from './state';

/** Допустимые масштабы экспорта PNG. */
export const EXPORT_SCALES = [1, 4, 8, 16] as const;
export type ExportScale = (typeof EXPORT_SCALES)[number];

export const DEFAULT_EXPORT_SCALE: ExportScale = 4;
export const MAX_EXPORT_PIXELS = 16_000_000;

export const EXPORT_FORMATS = ['png', 'jpeg', 'webp'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: string): value is ExportFormat {
  return EXPORT_FORMATS.some((format) => format === value);
}

export function isExportScale(value: number): value is ExportScale {
  return EXPORT_SCALES.some((scale) => scale === value);
}

export function isExportSizeAllowed(width: number, height: number, scale: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    Number.isInteger(scale) &&
    width > 0 &&
    height > 0 &&
    scale > 0 &&
    width * height * scale * scale <= MAX_EXPORT_PIXELS
  );
}

export function getAvailableExportScales(width: number, height: number): ExportScale[] {
  return EXPORT_SCALES.filter((scale) => isExportSizeAllowed(width, height, scale));
}

function assertExportSize(width: number, height: number, scale: number): void {
  if (!isExportSizeAllowed(width, height, scale)) {
    throw new RangeError(
      `Экспорт превышает лимит ${MAX_EXPORT_PIXELS.toLocaleString('ru-RU')} пикселей. Выберите меньший масштаб или уменьшите холст.`,
    );
  }
}

export interface RawImage {
  width: number;
  height: number;
  /** RGBA, строка за строкой. */
  data: Uint8ClampedArray;
}

/**
 * Увеличение методом ближайшего соседа: каждый пиксель превращается в квадрат
 * scale×scale без какого-либо сглаживания. Альфа-канал копируется как есть.
 */
export function scaleNearest(buffer: PixelBuffer, scale: number): RawImage {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new RangeError(`Масштаб должен быть целым числом не меньше 1, получено ${scale}`);
  }

  const { width, height, data } = buffer;
  assertExportSize(width, height, scale);
  const outWidth = width * scale;
  const outHeight = height * scale;
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  const row = new Uint8ClampedArray(outWidth * 4);

  for (let y = 0; y < height; y++) {
    let o = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      for (let k = 0; k < scale; k++) {
        row[o++] = r;
        row[o++] = g;
        row[o++] = b;
        row[o++] = a;
      }
    }
    const base = y * scale * outWidth * 4;
    for (let k = 0; k < scale; k++) {
      out.set(row, base + k * outWidth * 4);
    }
  }

  return { width: outWidth, height: outHeight, data: out };
}

/**
 * PNG с альфа-каналом в выбранном масштабе. Кодируется напрямую из буфера, минуя canvas:
 * canvas хранит пиксели premultiplied и искажает цвета полупрозрачных пикселей.
 */
export async function exportPngBlob(buffer: PixelBuffer, scale: number): Promise<Blob> {
  const bytes = await encodePngWithWorker(scaleNearest(buffer, scale));
  return new Blob([bytes], { type: 'image/png' });
}

export async function exportRasterBlob(
  buffer: PixelBuffer,
  scale: number,
  format: Exclude<ExportFormat, 'png'>,
  background: string,
): Promise<Blob> {
  assertExportSize(buffer.width, buffer.height, scale);
  const image = scaleNearest(buffer, scale);
  const source = document.createElement('canvas');
  source.width = image.width;
  source.height = image.height;
  const sourceContext = source.getContext('2d');
  if (!sourceContext) throw new Error('Не удалось создать холст для экспорта.');
  sourceContext.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Не удалось создать холст для экспорта.');

  if (format === 'jpeg') {
    context.fillStyle = background;
    context.fillRect(0, 0, image.width, image.height);
  }
  context.drawImage(source, 0, 0);

  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error(`Не удалось создать ${format.toUpperCase()}.`))),
      mimeType,
      0.92,
    );
  });
  if (blob.type !== mimeType) {
    throw new Error(`Среда приложения не поддерживает экспорт в ${format.toUpperCase()}.`);
  }
  return blob;
}
