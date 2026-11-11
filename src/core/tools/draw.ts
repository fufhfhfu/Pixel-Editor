import type { PixelBuffer, RGBA } from '../state';
import type { BrushShape } from './types';

export function bresenham(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (x: number, y: number) => void,
): void {
  let x = Math.trunc(x0);
  let y = Math.trunc(y0);
  const endX = Math.trunc(x1);
  const endY = Math.trunc(y1);
  const dx = Math.abs(endX - x);
  const sx = x < endX ? 1 : -1;
  const dy = -Math.abs(endY - y);
  const sy = y < endY ? 1 : -1;
  let error = dx + dy;

  while (true) {
    visit(x, y);
    if (x === endX && y === endY) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
}

export function isPixelPerfectCorner(
  before: { x: number; y: number },
  corner: { x: number; y: number },
  after: { x: number; y: number },
): boolean {
  const firstDx = corner.x - before.x;
  const firstDy = corner.y - before.y;
  const secondDx = after.x - corner.x;
  const secondDy = after.y - corner.y;
  return (
    Math.abs(firstDx) + Math.abs(firstDy) === 1 &&
    Math.abs(secondDx) + Math.abs(secondDy) === 1 &&
    Math.abs(after.x - before.x) === 1 &&
    Math.abs(after.y - before.y) === 1
  );
}

export function stampSquare(buffer: PixelBuffer, x: number, y: number, size: number, color: RGBA): void {
  const brush = Math.max(1, Math.trunc(size));
  const startX = Math.trunc(x) - Math.floor((brush - 1) / 2);
  const startY = Math.trunc(y) - Math.floor((brush - 1) / 2);
  for (let py = startY; py < startY + brush; py++) {
    for (let px = startX; px < startX + brush; px++) buffer.setPixel(px, py, color);
  }
}

export function stampCircle(buffer: PixelBuffer, x: number, y: number, size: number, color: RGBA): void {
  const brush = Math.max(1, Math.trunc(size));
  const startX = Math.trunc(x) - Math.floor((brush - 1) / 2);
  const startY = Math.trunc(y) - Math.floor((brush - 1) / 2);
  const center = (brush - 1) / 2;
  const radiusSquared = (brush / 2) ** 2;

  for (let py = 0; py < brush; py++) {
    for (let px = 0; px < brush; px++) {
      if ((px - center) ** 2 + (py - center) ** 2 <= radiusSquared) {
        buffer.setPixel(startX + px, startY + py, color);
      }
    }
  }
}

export function stampBrush(
  buffer: PixelBuffer,
  x: number,
  y: number,
  size: number,
  color: RGBA,
  shape: BrushShape = 'square',
): void {
  if (shape === 'circle') stampCircle(buffer, x, y, size, color);
  else stampSquare(buffer, x, y, size, color);
}

export function applyOpacity(color: RGBA, opacity = 1): RGBA {
  const alpha = Math.round(color.a * Math.min(1, Math.max(0, opacity)));
  return alpha === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { ...color, a: alpha };
}

export function drawLine(
  buffer: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  color: RGBA,
  shape: BrushShape = 'square',
  opacity = 1,
): void {
  if (opacity <= 0 || color.a === 0) return;
  const paint = applyOpacity(color, opacity);
  bresenham(x0, y0, x1, y1, (x, y) => stampBrush(buffer, x, y, size, paint, shape));
}

export function drawRect(
  buffer: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  color: RGBA,
  shape: BrushShape = 'square',
  opacity = 1,
): void {
  const left = Math.min(Math.trunc(x0), Math.trunc(x1));
  const right = Math.max(Math.trunc(x0), Math.trunc(x1));
  const top = Math.min(Math.trunc(y0), Math.trunc(y1));
  const bottom = Math.max(Math.trunc(y0), Math.trunc(y1));
  drawLine(buffer, left, top, right, top, size, color, shape, opacity);
  if (bottom !== top) drawLine(buffer, left, bottom, right, bottom, size, color, shape, opacity);
  if (right !== left) {
    drawLine(buffer, left, top + 1, left, bottom - 1, size, color, shape, opacity);
    drawLine(buffer, right, top + 1, right, bottom - 1, size, color, shape, opacity);
  }
}
