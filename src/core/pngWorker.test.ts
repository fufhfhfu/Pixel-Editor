import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodePng } from './png';
import { encodePngWithWorker } from './pngWorker';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PNG Worker', () => {
  it('encodes off the main thread and terminates the worker after completion', async () => {
    let terminated = false;
    class TestWorker {
      onmessage: ((event: MessageEvent<{ bytes?: ArrayBuffer; error?: string }>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;

      postMessage(message: { width: number; height: number; data: ArrayBuffer }): void {
        void encodePng({
          width: message.width,
          height: message.height,
          data: new Uint8ClampedArray(message.data),
        }).then((bytes) => this.onmessage?.({
          data: { bytes: bytes.buffer },
        } as MessageEvent<{ bytes: ArrayBuffer }>));
      }

      terminate(): void {
        terminated = true;
      }
    }
    vi.stubGlobal('Worker', TestWorker as unknown as typeof Worker);
    const image = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([10, 20, 30, 255]),
    };

    await expect(encodePngWithWorker(image)).resolves.toEqual(await encodePng(image));
    expect(terminated).toBe(true);
  });

  it('uses the main-thread encoder when Workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const image = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 128]),
    };

    await expect(encodePngWithWorker(image)).resolves.toEqual(await encodePng(image));
  });

  it('falls back to the main thread if the Worker fails', async () => {
    let terminated = false;
    class FailedWorker {
      onmessage: ((event: MessageEvent<{ bytes?: ArrayBuffer; error?: string }>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;

      postMessage(): void {
        queueMicrotask(() => this.onerror?.({ message: 'worker crashed' } as ErrorEvent));
      }

      terminate(): void {
        terminated = true;
      }
    }
    vi.stubGlobal('Worker', FailedWorker as unknown as typeof Worker);
    const image = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([10, 20, 30, 255]),
    };

    await expect(encodePngWithWorker(image)).resolves.toEqual(await encodePng(image));
    expect(terminated).toBe(true);
  });
});
