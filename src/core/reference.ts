import { CHANNELS, isValidCanvasSize, type PixelBuffer, type RGBA } from './state';

export const MAX_PROJECT_REFERENCES = 16;
export const MAX_REFERENCE_TOTAL_PIXELS = 1_000_000;
export const MAX_REFERENCE_COMPOSITE_PIXELS = 16_000_000;
export const MIN_REFERENCE_SCALE = 0.05;
export const MAX_REFERENCE_SCALE = 32;

export interface ReferenceImage {
  id: string;
  name: string;
  width: number;
  height: number;
  /** RGBA пиксели изображения, строка за строкой. */
  pixels: Uint8ClampedArray;
  /** Позиция верхнего левого угла до поворота, в координатах рабочего поля. */
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
}

export function isValidReference(reference: ReferenceImage): boolean {
  return (
    typeof reference.id === 'string' &&
    reference.id.length > 0 &&
    reference.id.length <= 80 &&
    typeof reference.name === 'string' &&
    reference.name.trim().length > 0 &&
    reference.name.length <= 255 &&
    isValidCanvasSize(reference.width, reference.height) &&
    reference.pixels instanceof Uint8ClampedArray &&
    reference.pixels.length === reference.width * reference.height * CHANNELS &&
    Number.isSafeInteger(reference.x) &&
    Math.abs(reference.x) <= 1_000_000 &&
    Number.isSafeInteger(reference.y) &&
    Math.abs(reference.y) <= 1_000_000 &&
    Number.isFinite(reference.scale) &&
    reference.scale >= MIN_REFERENCE_SCALE &&
    reference.scale <= MAX_REFERENCE_SCALE &&
    Number.isFinite(reference.rotation) &&
    reference.rotation >= -360 &&
    reference.rotation <= 360 &&
    Number.isFinite(reference.opacity) &&
    reference.opacity >= 0 &&
    reference.opacity <= 1 &&
    typeof reference.visible === 'boolean' &&
    typeof reference.locked === 'boolean'
  );
}

function referencePixelIndex(
  reference: ReferenceImage,
  worldX: number,
  worldY: number,
  centerX: number,
  centerY: number,
  cosine: number,
  sine: number,
): number | null {
  const dx = worldX - centerX;
  const dy = worldY - centerY;
  const imageX = (cosine * dx + sine * dy) / reference.scale + reference.width / 2;
  const imageY = (-sine * dx + cosine * dy) / reference.scale + reference.height / 2;
  const x = Math.floor(imageX);
  const y = Math.floor(imageY);
  if (x < 0 || y < 0 || x >= reference.width || y >= reference.height) return null;
  return (y * reference.width + x) * CHANNELS;
}

/** Возвращает исходный RGBA-пиксель под точкой рабочего поля или null вне изображения. */
export function sampleReferenceColor(
  reference: ReferenceImage,
  worldX: number,
  worldY: number,
): RGBA | null {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || reference.scale <= 0) return null;

  const centerX = reference.x + reference.width * reference.scale / 2;
  const centerY = reference.y + reference.height * reference.scale / 2;
  const radians = reference.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const offset = referencePixelIndex(reference, worldX, worldY, centerX, centerY, cosine, sine);
  if (offset === null) return null;
  return {
    r: reference.pixels[offset]!,
    g: reference.pixels[offset + 1]!,
    b: reference.pixels[offset + 2]!,
    a: reference.pixels[offset + 3]!,
  };
}

export function referenceAtPoint(
  references: readonly ReferenceImage[],
  worldX: number,
  worldY: number,
): ReferenceImage | null {
  for (let index = references.length - 1; index >= 0; index--) {
    const reference = references[index]!;
    if (reference.visible && sampleReferenceColor(reference, worldX, worldY) !== null) return reference;
  }
  return null;
}

/** Неразрушающе для источника: накладывает видимые референсы на отдельный буфер экспорта. */
export function applyReferencesToBuffer(
  target: PixelBuffer,
  canvasX: number,
  canvasY: number,
  references: readonly ReferenceImage[],
): PixelBuffer {
  let compositePixels = 0;
  for (const reference of references) {
    if (!reference.visible || reference.opacity === 0) continue;
    const centerX = reference.x + reference.width * reference.scale / 2;
    const centerY = reference.y + reference.height * reference.scale / 2;
    const radians = reference.rotation * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const extentX = (Math.abs(cosine) * reference.width + Math.abs(sine) * reference.height) * reference.scale / 2;
    const extentY = (Math.abs(sine) * reference.width + Math.abs(cosine) * reference.height) * reference.scale / 2;
    const left = Math.max(0, Math.floor(centerX - extentX - canvasX));
    const top = Math.max(0, Math.floor(centerY - extentY - canvasY));
    const right = Math.min(target.width, Math.ceil(centerX + extentX - canvasX));
    const bottom = Math.min(target.height, Math.ceil(centerY + extentY - canvasY));
    compositePixels += Math.max(0, right - left) * Math.max(0, bottom - top);
    if (compositePixels > MAX_REFERENCE_COMPOSITE_PIXELS) {
      throw new RangeError('Слишком много пикселей референсов пересекает холст для безопасного экспорта.');
    }

    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const sourceOffset = referencePixelIndex(
          reference,
          canvasX + x + 0.5,
          canvasY + y + 0.5,
          centerX,
          centerY,
          cosine,
          sine,
        );
        if (sourceOffset === null) continue;
        const sourceAlpha = (reference.pixels[sourceOffset + 3]! / 255) * reference.opacity;
        if (sourceAlpha === 0) continue;
        const offset = (y * target.width + x) * CHANNELS;
        const destinationAlpha = target.data[offset + 3]! / 255;
        const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
        const destinationFactor = destinationAlpha * (1 - sourceAlpha);
        target.data[offset] = Math.round((reference.pixels[sourceOffset]! * sourceAlpha + target.data[offset]! * destinationFactor) / outputAlpha);
        target.data[offset + 1] = Math.round((reference.pixels[sourceOffset + 1]! * sourceAlpha + target.data[offset + 1]! * destinationFactor) / outputAlpha);
        target.data[offset + 2] = Math.round((reference.pixels[sourceOffset + 2]! * sourceAlpha + target.data[offset + 2]! * destinationFactor) / outputAlpha);
        target.data[offset + 3] = Math.round(outputAlpha * 255);
      }
    }
  }
  target.markAllDirty();
  return target;
}
