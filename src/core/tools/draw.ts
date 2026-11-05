import type { PixelBuffer, RGBA } from '../state';

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

export function stampSquare(buffer: PixelBuffer, x: number, y: number, size: number, color: RGBA): void {
  const brush = Math.max(1, Math.trunc(size));
  const startX = Math.trunc(x) - Math.floor((brush - 1) / 2);
  const startY = Math.trunc(y) - Math.floor((brush - 1) / 2);
  for (let py = startY; py < startY + brush; py++) {
    for (let px = startX; px < startX + brush; px++) buffer.setPixel(px, py, color);
  }
}

export function drawLine(
  buffer: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  color: RGBA,
): void {
  bresenham(x0, y0, x1, y1, (x, y) => stampSquare(buffer, x, y, size, color));
}

export function drawRect(
  buffer: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  color: RGBA,
): void {
  const left = Math.min(Math.trunc(x0), Math.trunc(x1));
  const right = Math.max(Math.trunc(x0), Math.trunc(x1));
  const top = Math.min(Math.trunc(y0), Math.trunc(y1));
  const bottom = Math.max(Math.trunc(y0), Math.trunc(y1));
  drawLine(buffer, left, top, right, top, size, color);
  if (bottom !== top) drawLine(buffer, left, bottom, right, bottom, size, color);
  if (right !== left) {
    drawLine(buffer, left, top + 1, left, bottom - 1, size, color);
    drawLine(buffer, right, top + 1, right, bottom - 1, size, color);
  }
}
