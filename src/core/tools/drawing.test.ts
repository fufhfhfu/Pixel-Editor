import { describe, expect, it } from 'vitest';
import { PixelBuffer, type RGBA } from '../state';
import { floodFill, floodFillAsync } from './floodFill';
import { computeFloodFillOutput, type FloodFillWorkerRequest } from './floodFillWorker';
import { applyDither, ditherThreshold, paintGradient, parseCustomDitherPattern } from './paintEffects';
import { drawEllipse, drawPolygon, drawTriangle } from './shapes';
import { isPixelPerfectCorner } from './draw';
import {
  createBrushDefinition,
  parseBrushDefinition,
  parseBrushLibrary,
  resizeBrushDefinition,
  serializeBrushLibrary,
  stampBrushDefinition,
} from './brushLibrary';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const GREEN: RGBA = { r: 0, g: 255, b: 0, a: 255 };

describe('Pixel Perfect', () => {
  it('identifies orthogonal stair-step corners but not straight or diagonal runs', () => {
    expect(isPixelPerfectCorner({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })).toBe(true);
    expect(isPixelPerfectCorner({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false);
    expect(isPixelPerfectCorner({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBe(false);
  });

  it('keeps the compact diagonal endpoint pixels in a pixel-perfect stroke', () => {
    const b = new PixelBuffer(8, 8);
    const a = { x: 1, y: 1 };
    const corner = { x: 2, y: 1 };
    const c = { x: 2, y: 2 };
    b.setPixel(a.x, a.y, RED);
    b.setPixel(c.x, c.y, RED);
    expect(b.getPixel(corner.x, corner.y)?.a).toBe(0);
    expect(b.getPixel(a.x, a.y)?.a).toBe(255);
    expect(b.getPixel(c.x, c.y)?.a).toBe(255);
  });
});

describe('Bucket fill options', () => {
  it('computes a worker result without mutating the source buffer', () => {
    const source = new PixelBuffer(2, 1);
    source.setPixel(0, 0, RED);
    source.setPixel(1, 0, RED);
    const request: FloodFillWorkerRequest = {
      width: 2,
      height: 1,
      x: 0,
      y: 0,
      color: GREEN,
      options: {},
      pixels: source.data.slice().buffer,
      samplePixels: source.data.slice().buffer,
      alphaLock: false,
    };
    const result = computeFloodFillOutput(request);
    expect(Array.from(result)).toEqual([
      GREEN.r, GREEN.g, GREEN.b, GREEN.a,
      GREEN.r, GREEN.g, GREEN.b, GREEN.a,
    ]);
    expect(source.getPixel(0, 0)).toEqual(RED);
  });

  it('applies worker results in batches while preserving selection constraints', async () => {
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      terminated = false;

      postMessage(message: FloodFillWorkerRequest): void {
        const pixels = computeFloodFillOutput(message);
        queueMicrotask(() => this.onmessage?.({ data: { pixels: pixels.buffer } } as MessageEvent));
      }

      terminate(): void {
        this.terminated = true;
      }
    }

    const buffer = new PixelBuffer(3, 1);
    buffer.setClipMask(Uint8Array.from([1, 0, 1]));
    const worker = new FakeWorker();
    const result = await floodFillAsync(buffer, 0, 0, GREEN, {
      contiguous: false,
      workerFactory: () => worker as unknown as Worker,
    });
    expect(result).toBe(true);
    expect(buffer.getPixel(0, 0)).toEqual(GREEN);
    expect(buffer.getPixel(1, 0)?.a).toBe(0);
    expect(buffer.getPixel(2, 0)).toEqual(GREEN);
    expect(worker.terminated).toBe(true);
  });

  it('matches a reference flood traversal on randomized masks and both connectivities', () => {
    let random = 0x5eed1234;
    const nextRandom = () => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return random / 0x1_0000_0000;
    };

    for (const connectivity of [4, 8] as const) {
      for (let trial = 0; trial < 30; trial++) {
        const width = 17;
        const height = 13;
        const actual = new PixelBuffer(width, height);
        const expected = new PixelBuffer(width, height);
        const selection = new Uint8Array(width * height);
        for (let pixel = 0; pixel < width * height; pixel++) {
          const color = nextRandom() < 0.62 ? RED : BLUE;
          actual.setPixel(pixel % width, Math.floor(pixel / width), color);
          expected.setPixel(pixel % width, Math.floor(pixel / width), color);
          selection[pixel] = nextRandom() < 0.84 ? 1 : 0;
        }
        actual.takeDirty();
        expected.takeDirty();
        const startX = Math.floor(nextRandom() * width);
        const startY = Math.floor(nextRandom() * height);
        const start = startY * width + startX;
        const startColor = actual.getPixel(startX, startY)!;
        const visited = new Uint8Array(width * height);
        const queue = [start];
        const offsets = connectivity === 4
          ? [[0, -1], [-1, 0], [1, 0], [0, 1]]
          : [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
        let head = 0;
        while (head < queue.length) {
          const pixel = queue[head++]!;
          if (visited[pixel]) continue;
          visited[pixel] = 1;
          const px = pixel % width;
          const py = Math.floor(pixel / width);
          if (selection[pixel] === 0 || expected.getPixel(px, py)!.r !== startColor.r) continue;
          expected.setPixel(px, py, GREEN);
          for (const [dx, dy] of offsets) {
            const nx = px + dx!;
            const ny = py + dy!;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) queue.push(ny * width + nx);
          }
        }

        const expectedResult = expected.data.some((value, index) => value !== actual.data[index]);
        expect(floodFill(actual, startX, startY, GREEN, { selection, connectivity })).toBe(expectedResult);
        expect(actual.data).toEqual(expected.data);
      }
    }
  });

  it('global fill replaces separated matching pixels but leaves other colors alone', () => {
    const b = new PixelBuffer(4, 4);
    b.setPixel(0, 0, RED);
    b.setPixel(3, 3, RED);
    b.setPixel(1, 0, BLUE);
    expect(floodFill(b, 0, 0, GREEN, { contiguous: false })).toBe(true);
    expect(b.getPixel(3, 3)).toEqual(GREEN);
    expect(b.getPixel(1, 0)).toEqual(BLUE);
  });

  it('tolerance includes nearby colors while keeping distant colors', () => {
    const b = new PixelBuffer(3, 1);
    b.setPixel(0, 0, RED);
    b.setPixel(1, 0, { r: 250, g: 5, b: 0, a: 255 });
    b.setPixel(2, 0, BLUE);
    floodFill(b, 0, 0, GREEN, { tolerance: 5 });
    expect(b.getPixel(0, 0)).toEqual(GREEN);
    expect(b.getPixel(1, 0)).toEqual(GREEN);
    expect(b.getPixel(2, 0)).toEqual(BLUE);
  });

  it('fills an active layer using color connectivity sampled from the merged visible image', () => {
    const destination = new PixelBuffer(4, 1);
    const merged = new PixelBuffer(4, 1);
    merged.setPixel(0, 0, RED);
    merged.setPixel(1, 0, RED);
    merged.setPixel(2, 0, BLUE);

    expect(floodFill(destination, 0, 0, GREEN, { sampleBuffer: merged })).toBe(true);
    expect(destination.getPixel(0, 0)).toEqual(GREEN);
    expect(destination.getPixel(1, 0)).toEqual(GREEN);
    expect(destination.getPixel(2, 0)?.a).toBe(0);
    expect(merged.getPixel(0, 0)).toEqual(RED);
  });

  it('rejects a fill sample with different dimensions', () => {
    expect(() => floodFill(new PixelBuffer(1, 1), 0, 0, RED, { sampleBuffer: new PixelBuffer(2, 1) }))
      .toThrow(/matching dimensions/);
  });

  it('does not report a fill on a locked destination layer as a change', () => {
    const destination = new PixelBuffer(1, 1);
    const sample = new PixelBuffer(1, 1);
    sample.setPixel(0, 0, RED);
    destination.setLocked(true);
    expect(floodFill(destination, 0, 0, BLUE, { sampleBuffer: sample })).toBe(false);
    expect(destination.getPixel(0, 0)?.a).toBe(0);
  });

  it('8-connectivity includes diagonals but 4-connectivity does not', () => {
    const four = new PixelBuffer(2, 2);
    four.setPixel(1, 0, BLUE);
    four.setPixel(0, 1, BLUE);
    floodFill(four, 0, 0, RED, { connectivity: 4 });
    expect(four.getPixel(1, 1)?.a).toBe(0);

    const eight = new PixelBuffer(2, 2);
    eight.setPixel(1, 0, BLUE);
    eight.setPixel(0, 1, BLUE);
    floodFill(eight, 0, 0, RED, { connectivity: 8 });
    expect(eight.getPixel(1, 1)).toEqual(RED);
  });

  it('protects transparency and obeys a selection mask', () => {
    const b = new PixelBuffer(3, 1);
    b.setPixel(0, 0, RED);
    b.setPixel(2, 0, BLUE);
    const selection = Uint8Array.from([1, 1, 0]);
    floodFill(b, 0, 0, GREEN, { contiguous: false, selection, protectAlpha: true });
    expect(b.getPixel(0, 0)).toEqual({ ...GREEN, a: 255 });
    expect(b.getPixel(1, 0)?.a).toBe(0);
    expect(b.getPixel(2, 0)).toEqual(BLUE);
  });

  it('uses the PixelBuffer clip mask to constrain fill connectivity and writes', () => {
    const b = new PixelBuffer(3, 1);
    b.setClipMask(Uint8Array.from([1, 0, 1]));
    expect(floodFill(b, 0, 0, RED)).toBe(true);
    expect(b.getPixel(0, 0)).toEqual(RED);
    expect(b.getPixel(1, 0)?.a).toBe(0);
    expect(b.getPixel(2, 0)?.a).toBe(0);
  });

  it('preserves existing alpha on filled pixels', () => {
    const b = new PixelBuffer(1, 1);
    b.setPixel(0, 0, { r: 20, g: 30, b: 40, a: 90 });
    floodFill(b, 0, 0, GREEN, { protectAlpha: true });
    expect(b.getPixel(0, 0)).toEqual({ ...GREEN, a: 90 });
  });

  it('respects opacity when protecting alpha', () => {
    const b = new PixelBuffer(1, 1);
    b.setPixel(0, 0, { r: 0, g: 0, b: 255, a: 120 });
    floodFill(b, 0, 0, RED, { protectAlpha: true, opacity: 0.5 });
    expect(b.getPixel(0, 0)).toEqual({ r: 128, g: 0, b: 128, a: 120 });
  });
});

describe('Shape rasterization', () => {
  it('rasterizes deterministic outline and filled ellipses', () => {
    const outline = new PixelBuffer(9, 9);
    drawEllipse(outline, 1, 2, 7, 6, RED);
    expect(outline.getPixel(4, 2)).toEqual(RED);
    expect(outline.getPixel(4, 4)?.a).toBe(0);

    const filled = new PixelBuffer(9, 9);
    drawEllipse(filled, 1, 2, 7, 6, RED, true);
    expect(filled.getPixel(4, 4)).toEqual(RED);
  });

  it('draws outlined and filled triangles and polygons', () => {
    const triangle = new PixelBuffer(10, 10);
    drawTriangle(triangle, 1, 1, 8, 8, RED, true);
    expect(triangle.getPixel(4, 5)?.a).toBe(255);

    const polygon = new PixelBuffer(10, 10);
    drawPolygon(polygon, [{ x: 2, y: 2 }, { x: 7, y: 2 }, { x: 5, y: 7 }], BLUE);
    expect(polygon.getPixel(4, 2)).toEqual(BLUE);
    expect(polygon.getPixel(4, 4)?.a).toBe(0);
  });
});

describe('Gradients and dithering', () => {
  it('interpolates multiple RGBA stops and respects transparent stops', () => {
    const b = new PixelBuffer(5, 1);
    paintGradient(b, 0, 0, 4, 0, [
      { position: 0, color: RED },
      { position: 0.5, color: GREEN },
      { position: 1, color: { ...BLUE, a: 0 } },
    ]);
    expect(b.getPixel(0, 0)).toEqual(RED);
    expect(b.getPixel(2, 0)).toEqual(GREEN);
    expect(b.getPixel(4, 0)?.a).toBe(0);
  });

  it('supports ordered Bayer matrices and checkerboard density', () => {
    expect(ditherThreshold(0, 0, 'bayer2')).toBe(0);
    expect(ditherThreshold(1, 0, 'bayer2')).toBe(0.5);
    expect(ditherThreshold(0, 0, 'checkerboard')).toBe(0);
    expect(ditherThreshold(1, 0, 'checkerboard')).toBe(1);

    const b = new PixelBuffer(4, 4);
    applyDither(b, 0, 0, 3, 3, RED, BLUE, { pattern: 'checkerboard', density: 0.5 });
    expect(b.getPixel(0, 0)).toEqual(RED);
    expect(b.getPixel(1, 0)).toEqual(BLUE);
  });

  it('parses a custom pattern and rotates its ordered threshold', () => {
    expect(parseCustomDitherPattern('01/10')).toEqual([[0, 1], [1, 0]]);
    expect(() => parseCustomDitherPattern('01/1')).toThrow();
    expect(ditherThreshold(1, 0, 'checkerboard', 1, undefined, 90)).toBe(1);
  });

  it('dithers across every gradient stop instead of dropping intermediate colors', () => {
    const b = new PixelBuffer(8, 1);
    paintGradient(b, 0, 0, 7, 0, [
      { position: 0, color: RED },
      { position: 0.5, color: GREEN },
      { position: 1, color: BLUE },
    ], { dither: true });
    expect(new Set(Array.from({ length: 8 }, (_, x) => JSON.stringify(b.getPixel(x, 0)))).size).toBeGreaterThan(2);
    expect(b.getPixel(0, 0)).toEqual(RED);
    expect(b.getPixel(7, 0)).toEqual(BLUE);
  });
});

describe('Brush library', () => {
  it('creates, round-trips, validates, and stamps user brush definitions', () => {
    const brush = createBrushDefinition('Round stamp', 3, 'circle', 'custom');
    const serialized = serializeBrushLibrary([brush]);
    expect(parseBrushLibrary(serialized)).toEqual([brush]);
    expect(parseBrushDefinition(brush)).toEqual(brush);

    const b = new PixelBuffer(8, 8);
    stampBrushDefinition(b, 4, 4, RED, brush);
    expect(b.getPixel(4, 4)).toEqual(RED);
    expect(b.getPixel(2, 2)?.a).toBe(0);
  });

  it('resizes brush masks without breaking their validated dimensions', () => {
    const brush = createBrushDefinition('Round', 3, 'circle');
    const resized = resizeBrushDefinition(brush, 8);
    expect(resized.size).toBe(8);
    expect(resized.mask).toHaveLength(64);
    expect(parseBrushDefinition(resized)).toEqual(resized);
  });

  it('rejects malformed, oversized, and unsupported brush data', () => {
    const brush = createBrushDefinition('Test', 2);
    expect(() => parseBrushDefinition({ ...brush, mask: [1] })).toThrow();
    expect(() => parseBrushLibrary(JSON.stringify({ format: 'other', version: 1, brushes: [] }))).toThrow();
    expect(() => parseBrushLibrary('x'.repeat(256_001))).toThrow();
  });

  it('scatter remains deterministic for the same coordinates and settings', () => {
    const brush = createBrushDefinition('Scatter', 2, 'square', 'scatter');
    const first = new PixelBuffer(16, 16);
    const second = new PixelBuffer(16, 16);
    stampBrushDefinition(first, 8, 8, RED, brush);
    stampBrushDefinition(second, 8, 8, RED, brush);
    expect(first.data).toEqual(second.data);
  });
});
