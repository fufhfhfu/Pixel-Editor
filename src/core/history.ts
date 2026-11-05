/**
 * Ядро: история действий (undo/redo).
 * Чистый TypeScript, без зависимости от Svelte.
 *
 * Один штрих — один шаг. Во время штриха исходные цвета записываются только для
 * затронутых пикселей. Шаг истории хранит diff: индекс и цвета до/после изменения.
 *
 * Смена размера холста тоже шаг истории. Для её отмены хранятся только пиксели,
 * которые обрезка уничтожила (и только непрозрачные), а не весь холст.
 */

import { PixelBuffer } from './state';

export interface PixelStep {
  readonly kind: 'pixels';
  /** Размер холста, к которому относится шаг. */
  readonly width: number;
  readonly height: number;
  /** Индексы изменённых пикселей (номер пикселя, не байта). */
  readonly indices: Uint32Array;
  /** Значения RGBA до изменения (упакованы в 32 бита). */
  readonly before: Uint32Array;
  /** Значения RGBA после изменения. */
  readonly after: Uint32Array;
}

export interface ResizeStep {
  readonly kind: 'resize';
  readonly fromWidth: number;
  readonly fromHeight: number;
  readonly toWidth: number;
  readonly toHeight: number;
  /** Индексы (в координатах СТАРОГО холста) непрозрачных пикселей, потерянных при обрезке. */
  readonly lostIndices: Uint32Array;
  readonly lostValues: Uint32Array;
}

export type HistoryStep = PixelStep | ResizeStep;

export interface HistoryOptions {
  /** Верхняя граница числа шагов. */
  maxSteps?: number;
  /** Сколько последних шагов сохраняется всегда, даже при превышении лимита памяти. */
  minSteps?: number;
  /** Мягкий лимит памяти под шаги: старые шаги выбрасываются, но не меньше minSteps. */
  maxBytes?: number;
}

export const DEFAULT_MIN_STEPS = 100;
export const DEFAULT_MAX_STEPS = 500;
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

const BYTES_PER_CHANGED_PIXEL = 12;
const BYTES_PER_LOST_PIXEL = 8;
const STEP_OVERHEAD_BYTES = 48;

function pack(data: Uint8ClampedArray, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function unpack(data: Uint8ClampedArray, offset: number, value: number): void {
  data[offset] = value & 255;
  data[offset + 1] = (value >>> 8) & 255;
  data[offset + 2] = (value >>> 16) & 255;
  data[offset + 3] = value >>> 24;
}

function stepBytes(step: HistoryStep): number {
  return step.kind === 'pixels'
    ? step.indices.length * BYTES_PER_CHANGED_PIXEL + STEP_OVERHEAD_BYTES
    : step.lostIndices.length * BYTES_PER_LOST_PIXEL + STEP_OVERHEAD_BYTES;
}

/** Отличаются ли пиксели на экране: два полностью прозрачных пикселя всегда равны. */
function pixelDiffers(a: Uint8ClampedArray, b: Uint8ClampedArray, i: number): boolean {
  if (a[i + 3] === 0 && b[i + 3] === 0) return false;
  return a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3];
}

/** Сравнивает два состояния буфера и возвращает diff; null, если различий нет. */
export function createStep(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  width: number,
  height: number,
): PixelStep | null {
  const pixels = Math.min(before.length, after.length) >> 2;

  let count = 0;
  for (let p = 0, i = 0; p < pixels; p++, i += 4) {
    if (pixelDiffers(before, after, i)) count++;
  }
  if (count === 0) return null;

  const indices = new Uint32Array(count);
  const beforeValues = new Uint32Array(count);
  const afterValues = new Uint32Array(count);

  let k = 0;
  for (let p = 0, i = 0; p < pixels; p++, i += 4) {
    if (pixelDiffers(before, after, i)) {
      indices[k] = p;
      beforeValues[k] = pack(before, i);
      afterValues[k] = pack(after, i);
      k++;
    }
  }

  return { kind: 'pixels', width, height, indices, before: beforeValues, after: afterValues };
}

function applyPixelStep(buffer: PixelBuffer, step: PixelStep, side: 'before' | 'after'): void {
  const values = step[side];
  const width = buffer.width;
  for (let k = 0; k < step.indices.length; k++) {
    const p = step.indices[k];
    unpack(buffer.data, p * 4, values[k]);
    buffer.markDirty(p % width, Math.floor(p / width));
  }
}

/** Шаг изменения размера: запоминает непрозрачные пиксели, которые обрезка уничтожит. */
function createResizeStep(from: PixelBuffer, to: PixelBuffer): ResizeStep {
  const indices: number[] = [];
  for (let y = 0; y < from.height; y++) {
    for (let x = 0; x < from.width; x++) {
      if (x < to.width && y < to.height) continue;
      if (from.data[from.index(x, y) + 3] !== 0) indices.push(y * from.width + x);
    }
  }
  const lostIndices = Uint32Array.from(indices);
  const lostValues = new Uint32Array(lostIndices.length);
  for (let k = 0; k < lostIndices.length; k++) lostValues[k] = pack(from.data, lostIndices[k] * 4);

  return {
    kind: 'resize',
    fromWidth: from.width,
    fromHeight: from.height,
    toWidth: to.width,
    toHeight: to.height,
    lostIndices,
    lostValues,
  };
}

/** Отмена изменения размера: холст прежнего размера, обрезанные пиксели возвращены. */
function revertResize(step: ResizeStep, current: PixelBuffer): PixelBuffer {
  const restored = new PixelBuffer(step.fromWidth, step.fromHeight);
  const copyW = Math.min(current.width, restored.width);
  const copyH = Math.min(current.height, restored.height);
  for (let y = 0; y < copyH; y++) {
    const from = current.index(0, y);
    restored.data.set(current.data.subarray(from, from + copyW * 4), restored.index(0, y));
  }
  for (let k = 0; k < step.lostIndices.length; k++) {
    unpack(restored.data, step.lostIndices[k] * 4, step.lostValues[k]);
  }
  return restored;
}

export class History {
  private undoStack: HistoryStep[] = [];
  private redoStack: HistoryStep[] = [];
  private undoBytes = 0;
  private activeBuffer: PixelBuffer | null = null;
  private releaseCapture: (() => void) | null = null;
  private capturedPixels = new Map<number, number>();
  private capturedSnapshot: Uint8ClampedArray | null = null;

  private readonly maxSteps: number;
  private readonly minSteps: number;
  private readonly maxBytes: number;

  constructor(options: HistoryOptions = {}) {
    this.maxSteps = Math.max(1, options.maxSteps ?? DEFAULT_MAX_STEPS);
    this.minSteps = Math.min(Math.max(0, options.minSteps ?? DEFAULT_MIN_STEPS), this.maxSteps);
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0 && this.activeBuffer === null;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0 && this.activeBuffer === null;
  }

  get undoCount(): number {
    return this.undoStack.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }

  /** Штрих начат, но ещё не завершён. */
  get hasPendingStroke(): boolean {
    return this.activeBuffer !== null;
  }

  /** Приблизительный объём памяти, занятый шагами отмены, в байтах. */
  get memoryBytes(): number {
    return this.undoBytes;
  }

  /** Вызывается перед первым изменением штриха: запоминает исходное состояние. */
  begin(buffer: PixelBuffer): void {
    this.stopCapture();
    this.activeBuffer = buffer;
    this.capturedPixels.clear();
    this.capturedSnapshot = null;
    this.releaseCapture = buffer.captureChanges((pixelIndex, previousValue) => {
      if (this.capturedSnapshot) return;
      if (!this.capturedPixels.has(pixelIndex)) this.capturedPixels.set(pixelIndex, previousValue);
      if (this.capturedPixels.size > Math.min(65_536, buffer.width * buffer.height / 4)) {
        this.capturedSnapshot = buffer.data.slice();
        for (const [pixel, value] of this.capturedPixels) unpack(this.capturedSnapshot, pixel * 4, value);
        this.capturedPixels.clear();
      }
    });
  }

  /**
   * Завершает штрих: сравнивает буфер с исходным состоянием и записывает diff.
   * Возвращает true, если шаг записан (штрих что-то изменил на экране).
   */
  commit(buffer: PixelBuffer): boolean {
    if (this.activeBuffer !== buffer) {
      this.stopCapture();
      this.capturedPixels.clear();
      this.capturedSnapshot = null;
      return false;
    }
    this.stopCapture();
    const snapshot = this.capturedSnapshot;
    this.capturedSnapshot = null;
    if (snapshot) {
      this.capturedPixels.clear();
      const step = createStep(snapshot, buffer.data, buffer.width, buffer.height);
      if (!step) return false;
      this.push(step);
      return true;
    }

    const beforePixels = this.capturedPixels;
    this.capturedPixels = new Map();
    let count = 0;
    for (const [pixel, before] of beforePixels) {
      const offset = pixel * 4;
      if (
        ((before >>> 24) === 0 && buffer.data[offset + 3] === 0) ||
        pack(buffer.data, offset) === before
      ) {
        continue;
      }
      count++;
    }
    if (count === 0) return false;

    const indices = new Uint32Array(count);
    const beforeValues = new Uint32Array(count);
    const afterValues = new Uint32Array(count);
    let index = 0;
    for (const [pixel, before] of beforePixels) {
      const offset = pixel * 4;
      if (
        ((before >>> 24) === 0 && buffer.data[offset + 3] === 0) ||
        pack(buffer.data, offset) === before
      ) {
        continue;
      }
      indices[index] = pixel;
      beforeValues[index] = before;
      afterValues[index] = pack(buffer.data, offset);
      index++;
    }
    this.push({ kind: 'pixels', width: buffer.width, height: buffer.height, indices, before: beforeValues, after: afterValues });
    return true;
  }

  /** Отменяет незавершённый штрих целиком: буфер возвращается к состоянию до begin(). */
  rollback(buffer: PixelBuffer): boolean {
    if (this.activeBuffer !== buffer) {
      this.stopCapture();
      this.capturedPixels.clear();
      this.capturedSnapshot = null;
      return false;
    }
    this.stopCapture();
    if (this.capturedSnapshot) {
      buffer.data.set(this.capturedSnapshot);
    } else {
      for (const [pixel, value] of this.capturedPixels) unpack(buffer.data, pixel * 4, value);
    }
    this.capturedPixels.clear();
    this.capturedSnapshot = null;
    buffer.markAllDirty();
    return true;
  }

  /** Записывает изменение размера. Вызывать до подмены буфера: from — старый, to — новый. */
  recordResize(from: PixelBuffer, to: PixelBuffer): void {
    this.stopCapture();
    this.capturedPixels.clear();
    this.capturedSnapshot = null;
    this.push(createResizeStep(from, to));
  }

  /**
   * Отменяет последний шаг. Возвращает буфер, с которым теперь нужно работать:
   * тот же объект для шага-штриха и новый — для отмены изменения размера.
   * null, если отменять нечего или шаг не подходит к переданному буферу.
   */
  undo(buffer: PixelBuffer): PixelBuffer | null {
    if (this.activeBuffer) return null;
    const step = this.undoStack[this.undoStack.length - 1];
    if (!step) return null;

    let result: PixelBuffer;
    if (step.kind === 'pixels') {
      if (buffer.width !== step.width || buffer.height !== step.height) return null;
      applyPixelStep(buffer, step, 'before');
      result = buffer;
    } else {
      if (buffer.width !== step.toWidth || buffer.height !== step.toHeight) return null;
      result = revertResize(step, buffer);
    }

    this.undoStack.pop();
    this.undoBytes -= stepBytes(step);
    this.redoStack.push(step);
    return result;
  }

  /** Повторяет отменённый шаг; возвращаемое значение — как у undo(). */
  redo(buffer: PixelBuffer): PixelBuffer | null {
    if (this.activeBuffer) return null;
    const step = this.redoStack[this.redoStack.length - 1];
    if (!step) return null;

    let result: PixelBuffer;
    if (step.kind === 'pixels') {
      if (buffer.width !== step.width || buffer.height !== step.height) return null;
      applyPixelStep(buffer, step, 'after');
      result = buffer;
    } else {
      if (buffer.width !== step.fromWidth || buffer.height !== step.fromHeight) return null;
      result = buffer.resized(step.toWidth, step.toHeight);
    }

    this.redoStack.pop();
    this.undoStack.push(step);
    this.undoBytes += stepBytes(step);
    return result;
  }

  /** Удаляет только шаги повтора, когда новое действие создаёт новую ветку истории. */
  discardRedo(): void {
    this.redoStack = [];
  }

  /** Полностью очищает историю (загрузка проекта). */
  clear(): void {
    this.stopCapture();
    this.capturedPixels.clear();
    this.capturedSnapshot = null;
    this.undoStack = [];
    this.redoStack = [];
    this.undoBytes = 0;
  }

  private stopCapture(): void {
    this.releaseCapture?.();
    this.releaseCapture = null;
    this.activeBuffer = null;
  }

  private push(step: HistoryStep): void {
    this.undoStack.push(step);
    this.undoBytes += stepBytes(step);
    this.redoStack.length = 0;
    this.trim();
  }

  /** Выбрасывает самые старые шаги сверх лимитов; последние minSteps остаются всегда. */
  private trim(): void {
    while (
      this.undoStack.length > this.maxSteps ||
      (this.undoBytes > this.maxBytes && this.undoStack.length > this.minSteps)
    ) {
      const oldest = this.undoStack.shift();
      if (!oldest) break;
      this.undoBytes -= stepBytes(oldest);
    }
  }
}
