import { floodFill, type FloodFillOptions } from './floodFill';
import { PixelBuffer, type RGBA } from '../state';

export type WorkerFillOptions = Omit<FloodFillOptions, 'sampleBuffer' | 'selection'>;

export interface FloodFillWorkerRequest {
  width: number;
  height: number;
  x: number;
  y: number;
  color: RGBA;
  options: WorkerFillOptions;
  pixels: ArrayBuffer;
  samplePixels: ArrayBuffer;
  selection?: ArrayBuffer;
  alphaLock: boolean;
}

export interface FloodFillWorkerResponse {
  pixels?: ArrayBuffer;
  error?: string;
}

export function computeFloodFillOutput(request: FloodFillWorkerRequest): Uint8ClampedArray {
  const expectedLength = request.width * request.height * 4;
  if (
    !Number.isSafeInteger(expectedLength) ||
    expectedLength < 4 ||
    request.pixels.byteLength !== expectedLength ||
    request.samplePixels.byteLength !== expectedLength ||
    (request.selection && request.selection.byteLength !== request.width * request.height)
  ) {
    throw new RangeError('Fill worker received buffers with invalid dimensions.');
  }
  const destination = new PixelBuffer(request.width, request.height, new Uint8ClampedArray(request.pixels));
  const sample = new PixelBuffer(request.width, request.height, new Uint8ClampedArray(request.samplePixels));
  destination.setAlphaLock(request.alphaLock);
  const selection = request.selection ? new Uint8Array(request.selection) : undefined;
  if (selection) destination.setClipMask(selection);
  floodFill(destination, request.x, request.y, request.color, {
    ...request.options,
    selection,
    sampleBuffer: sample,
  });
  return destination.data;
}
