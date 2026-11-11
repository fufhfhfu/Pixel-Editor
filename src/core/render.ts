/**
 * Ядро: отрисовка буфера пикселей на canvas только в изменённой области.
 * Использует DOM (canvas, ImageData), но не Svelte.
 */

import type { DirtyRect, PixelBuffer } from './state';

/**
 * Рисует PixelBuffer на canvas размером width×height (1 пиксель буфера = 1 пиксель canvas;
 * масштаб и шахматный фон делает CSS).
 *
 * ImageData создаётся один раз на буфер и делит память с buffer.data, поэтому изменённый
 * прямоугольник уходит на canvas одним вызовом putImageData с dirty-параметрами, без
 * копирования и без перерисовки остального холста. Если среда всё же скопировала данные
 * в ImageData, перед выводом копируются только строки изменённой области.
 */
export class PixelRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private buffer: PixelBuffer | null = null;
  private image: ImageData | null = null;
  private sharesMemory = true;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D недоступен');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  /** Подключает буфер; весь холст будет перерисован при ближайшем render(). */
  attach(buffer: PixelBuffer): void {
    if (this.canvas.width !== buffer.width || this.canvas.height !== buffer.height) {
      // Смена размера очищает canvas, поэтому делается только при реальном изменении размера
      this.canvas.width = buffer.width;
      this.canvas.height = buffer.height;
    }
    this.buffer = buffer;
    this.image = new ImageData(buffer.data, buffer.width, buffer.height);
    this.sharesMemory = this.image.data === buffer.data;
    buffer.markAllDirty();
  }

  /** Выводит накопленную грязную область. Возвращает её или null, если рисовать нечего. */
  render(): DirtyRect | null {
    const { buffer, image } = this;
    if (!buffer || !image) return null;

    const dirty = buffer.takeDirty();
    if (!dirty) return null;

    if (!this.sharesMemory) {
      const stride = buffer.width * 4;
      for (let y = dirty.y; y < dirty.y + dirty.height; y++) {
        const from = y * stride + dirty.x * 4;
        image.data.set(buffer.data.subarray(from, from + dirty.width * 4), from);
      }
    }

    this.ctx.putImageData(image, 0, 0, dirty.x, dirty.y, dirty.width, dirty.height);
    return dirty;
  }
}
