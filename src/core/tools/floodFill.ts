import { TRANSPARENT } from '../color';
import type { PixelBuffer, RGBA } from '../state';
import type {
  FloodFillWorkerRequest,
  FloodFillWorkerResponse,
  WorkerFillOptions,
} from './floodFillWorker';

export interface FloodFillOptions {
  contiguous?: boolean;
  tolerance?: number;
  connectivity?: 4 | 8;
  protectAlpha?: boolean;
  opacity?: number;
  selection?: Uint8Array;
  sampleBuffer?: PixelBuffer;
}

export interface AsyncFloodFillOptions extends FloodFillOptions {
  signal?: AbortSignal;
  onProgress?: () => void;
  workerFactory?: () => Worker;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function computeWithWorker(
  worker: Worker,
  request: FloodFillWorkerRequest,
  transfer: Transferable[],
  signal?: AbortSignal,
): Promise<FloodFillWorkerResponse> {
  return new Promise((resolve, reject) => {
    const cleanUp = (): void => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const onAbort = (): void => {
      cleanUp();
      reject(new DOMException('Заливка отменена.', 'AbortError'));
    };
    worker.onmessage = (event: MessageEvent<FloodFillWorkerResponse>) => {
      cleanUp();
      resolve(event.data);
    };
    worker.onerror = (event: ErrorEvent) => {
      cleanUp();
      reject(event.error ?? new Error(event.message || 'Ошибка вычисления заливки в Worker.'));
    };
    worker.onmessageerror = () => {
      cleanUp();
      reject(new Error('Не удалось прочитать ответ Worker заливки.'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.postMessage(request, transfer);
  });
}

/** Performs the expensive region search in a worker and yields while applying pixels. */
export async function floodFillAsync(
  buffer: PixelBuffer,
  x: number,
  y: number,
  color: RGBA,
  options: AsyncFloodFillOptions = {},
): Promise<boolean> {
  if (!buffer.inBounds(x, y) || buffer.isLocked) return false;
  const sampleBuffer = options.sampleBuffer ?? buffer;
  const selection = options.selection ?? buffer.getClipMask();
  if (sampleBuffer.width !== buffer.width || sampleBuffer.height !== buffer.height) {
    throw new RangeError('Fill sample and destination buffers must have matching dimensions.');
  }
  if (selection && selection.length !== buffer.width * buffer.height) {
    throw new RangeError(`Selection mask must contain ${buffer.width * buffer.height} pixels.`);
  }
  if (options.signal?.aborted) throw new DOMException('Заливка отменена.', 'AbortError');
  if (typeof Worker === 'undefined' && !options.workerFactory) {
    throw new Error('В этом окружении недоступен Worker для асинхронной заливки.');
  }

  const destinationCopy = buffer.data.slice();
  const sampleCopy = sampleBuffer.data.slice();
  const selectionCopy = selection?.slice();
  const request: FloodFillWorkerRequest = {
    width: buffer.width,
    height: buffer.height,
    x,
    y,
    color,
    options: {
      contiguous: options.contiguous,
      tolerance: options.tolerance,
      connectivity: options.connectivity,
      protectAlpha: options.protectAlpha,
      opacity: options.opacity,
    } satisfies WorkerFillOptions,
    pixels: destinationCopy.buffer,
    samplePixels: sampleCopy.buffer,
    ...(selectionCopy ? { selection: selectionCopy.buffer } : {}),
    alphaLock: buffer.isAlphaLocked,
  };
  const worker = options.workerFactory
    ? options.workerFactory()
    : new Worker(new URL('./floodFill.worker.ts', import.meta.url), { type: 'module' });
  const transfer: Transferable[] = [request.pixels, request.samplePixels];
  if (request.selection) transfer.push(request.selection);
  const response = await computeWithWorker(worker, request, transfer, options.signal);
  if (response.error) throw new Error(response.error);
  if (!response.pixels || response.pixels.byteLength !== buffer.data.byteLength) {
    throw new Error('Worker заливки вернул повреждённый буфер пикселей.');
  }
  const result = new Uint8ClampedArray(response.pixels);
  const total = buffer.width * buffer.height;
  const batchSize = 32_768;
  let pixel = 0;
  let changed = false;

  while (pixel < total) {
    if (options.signal?.aborted) throw new DOMException('Заливка отменена.', 'AbortError');
    const chunkStart = pixel;
    const deadline = performance.now() + 8;
    buffer.batchUpdates(() => {
      while (pixel < total && pixel - chunkStart < batchSize && performance.now() < deadline) {
        const offset = pixel * 4;
        const r = result[offset]!;
        const g = result[offset + 1]!;
        const b = result[offset + 2]!;
        const a = result[offset + 3]!;
        if (
          buffer.data[offset] !== r ||
          buffer.data[offset + 1] !== g ||
          buffer.data[offset + 2] !== b ||
          buffer.data[offset + 3] !== a
        ) {
          const x = pixel % buffer.width;
          const y = Math.floor(pixel / buffer.width);
          if (buffer.setPixelChannels(x, y, r, g, b, a)) changed = true;
        }
        pixel++;
      }
    });
    options.onProgress?.();
    if (pixel < total) await nextFrame();
  }
  return changed;
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

/** Replaces a connected or global color region without recursion or a full-size pixel queue. */
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
  const total = width * height;
  if (selection && selection.length !== total) {
    throw new RangeError(`Selection mask must contain ${total} pixels.`);
  }
  if (buffer.isLocked) return false;

  const { data: sampleData } = sampleBuffer;
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
  const fill = color.a === 0 ? TRANSPARENT : color;
  const { data } = buffer;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let changed = false;

  const paintPixel = (pixel: number, px: number, py: number): void => {
    const offset = pixel * 4;
    const oldR = data[offset]!;
    const oldG = data[offset + 1]!;
    const oldB = data[offset + 2]!;
    const oldA = data[offset + 3]!;
    let nextR: number;
    let nextG: number;
    let nextB: number;
    let nextA: number;

    if (options.protectAlpha) {
      if (oldA === 0) return;
      nextR = Math.round(oldR + (fill.r - oldR) * opacity);
      nextG = Math.round(oldG + (fill.g - oldG) * opacity);
      nextB = Math.round(oldB + (fill.b - oldB) * opacity);
      nextA = oldA;
    } else if (opacity === 1) {
      nextR = fill.r;
      nextG = fill.g;
      nextB = fill.b;
      nextA = fill.a;
    } else {
      const sourceAlpha = (fill.a / 255) * opacity;
      const destinationAlpha = oldA / 255;
      const alpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      if (alpha === 0) {
        nextR = 0;
        nextG = 0;
        nextB = 0;
        nextA = 0;
      } else {
        const inverseSourceAlpha = destinationAlpha * (1 - sourceAlpha);
        nextR = Math.round((fill.r * sourceAlpha + oldR * inverseSourceAlpha) / alpha);
        nextG = Math.round((fill.g * sourceAlpha + oldG * inverseSourceAlpha) / alpha);
        nextB = Math.round((fill.b * sourceAlpha + oldB * inverseSourceAlpha) / alpha);
        nextA = Math.round(alpha * 255);
      }
    }

    if (
      !(oldA === 0 && nextA === 0) &&
      (oldR !== nextR || oldG !== nextG || oldB !== nextB || oldA !== nextA) &&
      buffer.setPixelChannels(px, py, nextR, nextG, nextB, nextA)
    ) {
      changed = true;
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  };

  buffer.batchUpdates(() => {
    if (!contiguous) {
      for (let py = 0; py < height; py++) {
        const rowOffset = py * width;
        for (let px = 0; px < width; px++) {
          const pixel = rowOffset + px;
          if (matches(pixel)) paintPixel(pixel, px, py);
        }
      }
      return;
    }

    const visited = new Uint8Array(Math.ceil(total / 8));
    const isVisited = (pixel: number): boolean =>
      (visited[pixel >>> 3]! & (1 << (pixel & 7))) !== 0;
    const markVisited = (pixel: number): void => {
      visited[pixel >>> 3] = visited[pixel >>> 3]! | (1 << (pixel & 7));
    };
    const stack: number[] = [start];
    const adjacentPadding = connectivity === 8 ? 1 : 0;

    while (stack.length > 0) {
      const seed = stack.pop()!;
      if (isVisited(seed) || !matches(seed)) continue;
      const row = Math.floor(seed / width);
      const seedX = seed - row * width;
      let left = seedX;
      let right = seedX;
      while (left > 0 && !isVisited(row * width + left - 1) && matches(row * width + left - 1)) left--;
      while (right + 1 < width && !isVisited(row * width + right + 1) && matches(row * width + right + 1)) right++;

      const rowOffset = row * width;
      for (let px = left; px <= right; px++) {
        const pixel = rowOffset + px;
        markVisited(pixel);
        paintPixel(pixel, px, row);
      }

      for (let direction = -1; direction <= 1; direction += 2) {
        const neighborY = row + direction;
        if (neighborY < 0 || neighborY >= height) continue;
        const scanLeft = Math.max(0, left - adjacentPadding);
        const scanRight = Math.min(width - 1, right + adjacentPadding);
        const neighborOffset = neighborY * width;
        let px = scanLeft;
        while (px <= scanRight) {
          const pixel = neighborOffset + px;
          if (isVisited(pixel) || !matches(pixel)) {
            px++;
            continue;
          }
          stack.push(pixel);
          do {
            px++;
          } while (
            px <= scanRight &&
            !isVisited(neighborOffset + px) &&
            matches(neighborOffset + px)
          );
        }
      }
    }
  });

  return changed;
}
