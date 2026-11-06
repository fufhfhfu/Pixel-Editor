/**
 * Ядро: данные пикселей.
 * Чистый TypeScript, без зависимости от Svelte.
 */

/** Каналов на пиксель (RGBA). */
export const CHANNELS = 4;

/** Встроенные квадратные размеры холста от компактных иконок до крупных спрайтов. */
export const GRID_PRESETS: readonly number[] = [8, 16, 32, 64, 128, 256, 512, 1024];

export const DEFAULT_GRID_SIZE = 32;
export const MIN_GRID_SIZE = 1;
export const MAX_GRID_SIZE = 4096;
export const MAX_GRID_PIXELS = 4_194_304;

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type PixelChangeListener = (pixelIndex: number, previousValue: number) => void;

export function isValidGridSize(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_GRID_SIZE && value <= MAX_GRID_SIZE;
}

export function isValidCanvasSize(width: number, height: number): boolean {
  return isValidGridSize(width) && isValidGridSize(height) && width * height <= MAX_GRID_PIXELS;
}

/** Прямоугольник в пикселях холста (включительно по размеру: width и height ≥ 1). */
export interface DirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Приводит все полностью прозрачные пиксели (a = 0) к каноническому виду (0, 0, 0, 0).
 * Иначе «прозрачный» пиксель может прятать ненулевой RGB: заливка и история тогда
 * считают такие пиксели разными, хотя на экране они неотличимы.
 * Возвращает число исправленных пикселей.
 */
export function normalizeTransparent(data: Uint8ClampedArray): number {
  let fixed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0 && (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0)) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      fixed++;
    }
  }
  return fixed;
}

/**
 * Буфер пикселей: Uint8ClampedArray в формате RGBA, строка за строкой.
 * Размер буфера неизменяем; для смены размера создаётся новый буфер (resized).
 *
 * Буфер помнит «грязную» область — объединение всех изменённых с прошлого takeDirty()
 * пикселей. По ней отрисовка обновляет на canvas только изменённый прямоугольник.
 * Код, который пишет в data напрямую (заливка, история), обязан вызвать markDirty*.
 */
export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  private readonly changeListeners = new Set<PixelChangeListener>();
  private clipMask: Uint8Array | null = null;
  private locked = false;
  private alphaLock = false;

  // Грязная область: границы включительно; minX > maxX означает «изменений нет»
  private dirtyMinX = 0;
  private dirtyMinY = 0;
  private dirtyMaxX = -1;
  private dirtyMaxY = -1;
  private contentRevision = 0;

  constructor(width: number, height: number, data?: Uint8ClampedArray) {
    if (!isValidCanvasSize(width, height)) {
      throw new RangeError(
        `Недопустимый размер сетки ${width}×${height}: каждая сторона должна быть от ${MIN_GRID_SIZE} до ${MAX_GRID_SIZE}, площадь — не более ${MAX_GRID_PIXELS} пикселей`,
      );
    }
    const expected = width * height * CHANNELS;
    if (data) {
      if (data.length !== expected) {
        throw new RangeError(`Ожидалось ${expected} байт данных, получено ${data.length}`);
      }
      this.data = data;
    } else {
      this.data = new Uint8ClampedArray(expected);
    }
    this.width = width;
    this.height = height;
    this.markAllDirty();
  }

  inBounds(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Индекс первого байта (R) пикселя (x, y). Границы не проверяются. */
  index(x: number, y: number): number {
    return (y * this.width + x) * CHANNELS;
  }

  /** Цвет пикселя или null, если координаты вне холста. */
  getPixel(x: number, y: number): RGBA | null {
    if (!this.inBounds(x, y)) return null;
    const i = this.index(x, y);
    const d = this.data;
    return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
  }

  /**
   * Записывает пиксель и помечает его изменённым. Возвращает false, если координаты вне холста.
   * Полностью прозрачный цвет всегда записывается как (0, 0, 0, 0).
   */
  setPixel(x: number, y: number, color: RGBA): boolean {
    if (!this.inBounds(x, y)) return false;
    const pixel = y * this.width + x;
    if (this.locked) return false;
    if (this.clipMask && this.clipMask[pixel] === 0) return false;
    this.capturePixel(pixel);
    const i = this.index(x, y);
    const d = this.data;
    if (this.alphaLock) {
      if (d[i + 3] === 0 || color.a === 0) return false;
      const opacity = color.a / 255;
      d[i] = Math.round(d[i] + (color.r - d[i]) * opacity);
      d[i + 1] = Math.round(d[i + 1] + (color.g - d[i + 1]) * opacity);
      d[i + 2] = Math.round(d[i + 2] + (color.b - d[i + 2]) * opacity);
    } else if (color.a === 0) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 0;
    } else {
      d[i] = color.r;
      d[i + 1] = color.g;
      d[i + 2] = color.b;
      d[i + 3] = color.a;
    }
    this.markDirty(x, y);
    return true;
  }

  setClipMask(mask: Uint8Array | null): void {
    if (mask && mask.length !== this.width * this.height) {
      throw new RangeError(`Selection mask must contain ${this.width * this.height} pixels.`);
    }
    this.clipMask = mask;
  }

  getClipMask(): Uint8Array | null {
    return this.clipMask;
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  setAlphaLock(alphaLock: boolean): void {
    this.alphaLock = alphaLock;
  }

  get isAlphaLocked(): boolean {
    return this.alphaLock;
  }

  /** Changes whenever pixel data is marked dirty; useful for derived render caches. */
  get revision(): number {
    return this.contentRevision;
  }

  /** Делает весь холст прозрачным. */
  clear(): void {
    if (this.locked || this.alphaLock) return;
    if (this.changeListeners.size > 0) {
      for (let pixel = 0; pixel < this.width * this.height; pixel++) {
        const i = pixel * CHANNELS;
        if (this.data[i + 3] !== 0) this.capturePixel(pixel);
      }
    }
    this.data.fill(0);
    this.markAllDirty();
  }

  /** Наблюдает только реальные записи пикселей, не копируя весь буфер. */
  captureChanges(listener: PixelChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Записывает исходный цвет перед прямым изменением data; индекс задаётся в пикселях. */
  capturePixel(pixelIndex: number): void {
    if (this.changeListeners.size === 0 || !Number.isInteger(pixelIndex) || pixelIndex < 0 || pixelIndex >= this.width * this.height) {
      return;
    }
    const offset = pixelIndex * CHANNELS;
    const value =
      (this.data[offset] |
        (this.data[offset + 1] << 8) |
        (this.data[offset + 2] << 16) |
        (this.data[offset + 3] << 24)) >>>
      0;
    for (const listener of this.changeListeners) listener(pixelIndex, value);
  }

  /** Помечает один пиксель изменённым; координаты вне холста игнорируются. */
  markDirty(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.contentRevision++;
    if (this.dirtyMinX > this.dirtyMaxX) {
      this.dirtyMinX = this.dirtyMaxX = x;
      this.dirtyMinY = this.dirtyMaxY = y;
      return;
    }
    if (x < this.dirtyMinX) this.dirtyMinX = x;
    if (x > this.dirtyMaxX) this.dirtyMaxX = x;
    if (y < this.dirtyMinY) this.dirtyMinY = y;
    if (y > this.dirtyMaxY) this.dirtyMaxY = y;
  }

  /** Помечает прямоугольник изменённым; часть за границами холста отсекается. */
  markDirtyRect(x: number, y: number, width: number, height: number): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width - 1, Math.ceil(x + width) - 1);
    const y1 = Math.min(this.height - 1, Math.ceil(y + height) - 1);
    if (x0 > x1 || y0 > y1) return;
    this.markDirty(x0, y0);
    this.markDirty(x1, y1);
  }

  markAllDirty(): void {
    this.contentRevision++;
    this.dirtyMinX = 0;
    this.dirtyMinY = 0;
    this.dirtyMaxX = this.width - 1;
    this.dirtyMaxY = this.height - 1;
  }

  /** Есть ли изменения, которые ещё не отрисованы. */
  get isDirty(): boolean {
    return this.dirtyMinX <= this.dirtyMaxX;
  }

  /** Возвращает накопленную грязную область и сбрасывает её; null, если изменений нет. */
  takeDirty(): DirtyRect | null {
    if (!this.isDirty) return null;
    const rect: DirtyRect = {
      x: this.dirtyMinX,
      y: this.dirtyMinY,
      width: this.dirtyMaxX - this.dirtyMinX + 1,
      height: this.dirtyMaxY - this.dirtyMinY + 1,
    };
    this.dirtyMinX = 0;
    this.dirtyMinY = 0;
    this.dirtyMaxX = -1;
    this.dirtyMaxY = -1;
    return rect;
  }

  clone(): PixelBuffer {
    return new PixelBuffer(this.width, this.height, this.data.slice());
  }

  /**
   * Новый буфер другого размера. Содержимое копируется от левого верхнего угла,
   * то, что не помещается, обрезается; новая область прозрачная.
   */
  resized(width: number, height: number): PixelBuffer {
    const next = new PixelBuffer(width, height);
    const copyW = Math.min(this.width, width);
    const copyH = Math.min(this.height, height);
    for (let y = 0; y < copyH; y++) {
      const from = this.index(0, y);
      next.data.set(this.data.subarray(from, from + copyW * CHANNELS), next.index(0, y));
    }
    return next;
  }
}
