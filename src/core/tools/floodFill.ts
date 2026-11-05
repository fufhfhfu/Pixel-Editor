import { TRANSPARENT } from '../color';
import type { PixelBuffer, RGBA } from '../state';

export interface FloodFillOptions {
  contiguous?: boolean;
  tolerance?: number;
  connectivity?: 4 | 8;
  protectAlpha?: boolean;
  opacity?: number;
  selection?: Uint8Array;
  sampleBuffer?: PixelBuffer;
}

function matchesColor(data: Uint8ClampedArray, offset: number, target: RGBA, tolerance: number): boolean {
  if (target.a === 0) return data[offset + 3] === 0;
  return (
    Math.abs(data[offset] - target.r) <= tolerance &&
    Math.abs(data[offset + 1] - target.g) <= tolerance &&
    Math.abs(data[offset + 2] - target.b) <= tolerance &&
    Math.abs(data[offset + 3] - target.a) <= tolerance
  );
}

function compositeOver(source: RGBA, destination: RGBA, opacity: number): RGBA {
  const sourceAlpha = (source.a / 255) * opacity;
  const destinationAlpha = destination.a / 255;
  const alpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (alpha === 0) return TRANSPARENT;
  return {
    r: Math.round((source.r * sourceAlpha + destination.r * destinationAlpha * (1 - sourceAlpha)) / alpha),
    g: Math.round((source.g * sourceAlpha + destination.g * destinationAlpha * (1 - sourceAlpha)) / alpha),
    b: Math.round((source.b * sourceAlpha + destination.b * destinationAlpha * (1 - sourceAlpha)) / alpha),
    a: Math.round(alpha * 255),
  };
}

/** Replaces a connected or global color region without recursion. */
export function floodFill(
  buffer: PixelBuffer,
  x: number,
  y: number,
  color: RGBA,
  options: FloodFillOptions = {},
): boolean {
  if (!buffer.inBounds(x, y)) return false;
  const contiguous = options.contiguous ?? true;
  const tolerance = Math.max(0, Math.min(255, Math.round(options.tolerance ?? 0)));
  const connectivity = options.connectivity ?? 4;
  const opacity = Math.max(0, Math.min(1, options.opacity ?? 1));
  const selection = options.selection ?? buffer.getClipMask();
  const { width, height } = buffer;
  const sampleBuffer = options.sampleBuffer ?? buffer;
  if (sampleBuffer.width !== width || sampleBuffer.height !== height) {
    throw new RangeError('Fill sample and destination buffers must have matching dimensions.');
  }
  const { data: sampleData } = sampleBuffer;
  const { data } = buffer;
  const total = width * height;
  if (selection && selection.length !== total) {
    throw new RangeError(`Selection mask must contain ${total} pixels.`);
  }
  const start = y * width + x;
  if (selection && selection[start] === 0) return false;
  const startOffset = start * 4;
  const target: RGBA = {
    r: sampleData[startOffset],
    g: sampleData[startOffset + 1],
    b: sampleData[startOffset + 2],
    a: sampleData[startOffset + 3],
  };
  const matches = (pixel: number): boolean =>
    (!selection || selection[pixel] !== 0) &&
    matchesColor(sampleData, pixel * 4, target, tolerance);

  const visited = new Uint8Array(total);
  const queue = new Uint32Array(total);
  let head = 0;
  let tail = 0;
  const neighborOffsets = connectivity === 8
    ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const
    : [[0, -1], [-1, 0], [1, 0], [0, 1]] as const;

  if (contiguous) {
    queue[tail++] = start;
    visited[start] = 1;
  } else {
    for (let pixel = 0; pixel < total; pixel++) {
      if ((!selection || selection[pixel] !== 0) && matchesColor(sampleData, pixel * 4, target, tolerance)) {
        queue[tail++] = pixel;
      }
    }
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let changed = false;
  const fill = color.a === 0 ? TRANSPARENT : color;

  while (head < tail) {
    const pixel = queue[head++];
    if (contiguous && !matches(pixel)) continue;
    const px = pixel % width;
    const py = Math.floor(pixel / width);
    const offset = pixel * 4;
    const old: RGBA = {
      r: data[offset],
      g: data[offset + 1],
      b: data[offset + 2],
      a: data[offset + 3],
    };
    const next = options.protectAlpha
      ? old.a === 0
        ? old
        : {
            r: Math.round(old.r + (fill.r - old.r) * opacity),
            g: Math.round(old.g + (fill.g - old.g) * opacity),
            b: Math.round(old.b + (fill.b - old.b) * opacity),
            a: old.a,
          }
      : opacity === 1
        ? fill
        : compositeOver(fill, old, opacity);

    if (
      !(old.a === 0 && next.a === 0) &&
      (old.r !== next.r || old.g !== next.g || old.b !== next.b || old.a !== next.a)
    ) {
      if (buffer.setPixel(px, py, next)) {
        changed = true;
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
    }

    if (!contiguous) continue;
    for (const [dx, dy] of neighborOffsets) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const neighbor = ny * width + nx;
      if (visited[neighbor]) continue;
      visited[neighbor] = 1;
      if (matches(neighbor)) queue[tail++] = neighbor;
    }
  }

  if (changed) buffer.markDirtyRect(minX, minY, maxX - minX + 1, maxY - minY + 1);
  return changed;
}
