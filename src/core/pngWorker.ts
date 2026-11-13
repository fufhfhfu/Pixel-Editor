import { encodePng } from './png';
import type { PngImage } from './png';

export async function encodePngWithWorker(image: PngImage): Promise<Uint8Array> {
  if (typeof Worker === 'undefined') return encodePng(image);

  let worker: Worker;
  try {
    worker = new Worker(new URL('../workers/png.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return encodePng(image);
  }

  const pixels = new Uint8Array(image.data);
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ bytes?: ArrayBuffer; error?: string }>) => {
        if (event.data.error) {
          reject(new Error(event.data.error));
          return;
        }
        if (!(event.data.bytes instanceof ArrayBuffer)) {
          reject(new Error('PNG Worker вернул некорректный результат.'));
          return;
        }
        resolve(new Uint8Array(event.data.bytes));
      };
      worker.onerror = (event) => reject(new Error(event.message || 'Ошибка PNG Worker.'));
      worker.onmessageerror = () => reject(new Error('Не удалось прочитать ответ PNG Worker.'));
      worker.postMessage({
        width: image.width,
        height: image.height,
        data: pixels.buffer,
      }, [pixels.buffer]);
    });
  } catch {
    return encodePng(image);
  } finally {
    worker.terminate();
  }
}
