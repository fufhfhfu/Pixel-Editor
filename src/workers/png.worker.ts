import { encodePng } from '../core/png';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<{ width: number; height: number; data: ArrayBuffer }>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

workerScope.onmessage = async (event: MessageEvent<{ width: number; height: number; data: ArrayBuffer }>) => {
  try {
    const bytes = await encodePng({
      width: event.data.width,
      height: event.data.height,
      data: new Uint8ClampedArray(event.data.data),
    });
    workerScope.postMessage(bytes, [bytes.buffer]);
  } catch (error) {
    workerScope.postMessage({ error: error instanceof Error ? error.message : 'PNG encoding failed.' });
  }
};
