import type { PixelBuffer, RGBA } from '../state';
import type { BrushShape, Tool, ToolContext, ToolMeta } from './types';

export type ShapeDrawer = (
  buffer: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  color: RGBA,
  shape?: BrushShape,
  opacity?: number,
  context?: ToolContext,
) => void;

/**
 * Инструмент фигуры (линия, прямоугольник): пока кнопка зажата, фигура показывается
 * вживую. Для этого перед каждой перерисовкой буфер возвращается к снимку,
 * сделанному в момент нажатия, и фигура рисуется заново от начальной точки.
 * Системная отмена ввода (cancel) восстанавливает исходные пиксели.
 *
 * Перерисовывается только область, которую занимали прежняя и новая фигуры.
 */
export function createShapeTool(meta: ToolMeta, draw: ShapeDrawer): Tool {
  let currentPreviewPixels: Map<number, number> | null = null;
  let lastPreviewPixels: Map<number, number> | null = null;
  let releaseCapture: (() => void) | null = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let lastSize = 1;

  /** Помечает изменённой рамку между двумя углами с запасом на толщину кисти. */
  function markBox(buffer: PixelBuffer, x1: number, y1: number, size: number): void {
    const pad = size;
    const left = Math.min(startX, x1) - pad;
    const top = Math.min(startY, y1) - pad;
    const right = Math.max(startX, x1) + pad;
    const bottom = Math.max(startY, y1) + pad;
    buffer.markDirtyRect(left, top, right - left + 1, bottom - top + 1);
  }

  function render(ctx: ToolContext, x: number, y: number): void {
    if (!releaseCapture) return;
    // Область прежней фигуры (с её толщиной) и новой — обе должны быть перерисованы
    markBox(ctx.buffer, lastX, lastY, lastSize);
    restorePreview(ctx.buffer);
    const previewPixels = new Map<number, number>();
    currentPreviewPixels = previewPixels;
    const pressure = ctx.pressure ?? 1;
    const size = Math.max(1, Math.round(ctx.brushSize * Math.min(1, Math.max(0, pressure))));
    let endX = x;
    let endY = y;
    const angleSnap = ctx.settings?.lineAngleSnap ?? 0;
    if (meta.id === 'line' && angleSnap > 0) {
      const dx = x - startX;
      const dy = y - startY;
      const distance = Math.hypot(dx, dy);
      const step = (angleSnap * Math.PI) / 180;
      const angle = Math.round(Math.atan2(dy, dx) / step) * step;
      endX = Math.round(startX + Math.cos(angle) * distance);
      endY = Math.round(startY + Math.sin(angle) * distance);
    }
    draw(ctx.buffer, startX, startY, endX, endY, size, ctx.color, ctx.brushShape, ctx.opacity, ctx);
    currentPreviewPixels = null;
    lastPreviewPixels = previewPixels;
    lastX = x;
    lastY = y;
    lastSize = Math.max(1, Math.round(ctx.brushSize * Math.min(1, Math.max(0, ctx.pressure ?? 1))));
    markBox(ctx.buffer, x, y, ctx.brushSize);
    ctx.invalidate();
  }

  function restorePreview(buffer: PixelBuffer): void {
    if (!lastPreviewPixels) return;
    for (const [pixel, value] of lastPreviewPixels) {
      const offset = pixel * 4;
      buffer.data[offset] = value & 255;
      buffer.data[offset + 1] = (value >>> 8) & 255;
      buffer.data[offset + 2] = (value >>> 16) & 255;
      buffer.data[offset + 3] = value >>> 24;
    }
  }

  return {
    ...meta,
    begin(ctx, x, y) {
      currentPreviewPixels = null;
      lastPreviewPixels = null;
      releaseCapture = ctx.buffer.captureChanges((pixel, previousValue) => {
        if (currentPreviewPixels && !currentPreviewPixels.has(pixel)) {
          currentPreviewPixels.set(pixel, previousValue);
        }
      });
      startX = x;
      startY = y;
      lastX = x;
      lastY = y;
      lastSize = ctx.brushSize;
      render(ctx, x, y);
    },
    move(ctx, x, y) {
      if (!releaseCapture || (x === lastX && y === lastY)) return;
      render(ctx, x, y);
    },
    end(ctx, x, y) {
      render(ctx, x, y);
      releaseCapture?.();
      releaseCapture = null;
      currentPreviewPixels = null;
      lastPreviewPixels = null;
    },
    cancel(ctx) {
      if (!releaseCapture) return;
      markBox(ctx.buffer, lastX, lastY, lastSize);
      restorePreview(ctx.buffer);
      releaseCapture?.();
      releaseCapture = null;
      currentPreviewPixels = null;
      lastPreviewPixels = null;
      ctx.invalidate();
    },
  };
}
