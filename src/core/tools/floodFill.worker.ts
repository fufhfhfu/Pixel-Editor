import {
  computeFloodFillOutput,
  type FloodFillWorkerRequest,
  type FloodFillWorkerResponse,
} from './floodFillWorker';

interface WorkerScope {
  onmessage: ((event: MessageEvent<FloodFillWorkerRequest>) => void) | null;
  postMessage(message: FloodFillWorkerResponse, transfer: Transferable[]): void;
}

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  try {
    const pixels = computeFloodFillOutput(event.data);
    workerScope.postMessage({ pixels: pixels.buffer }, [pixels.buffer]);
  } catch (error) {
    workerScope.postMessage({
      error: error instanceof Error ? error.message : String(error),
    }, []);
  }
};
