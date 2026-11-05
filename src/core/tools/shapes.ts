import type { PixelBuffer, RGBA } from '../state';
import { applyOpacity, bresenham, drawLine } from './draw';

function paintPixel(buffer: PixelBuffer, x: number, y: number, color: RGBA): void {
  buffer.setPixel(x, y, color);
}

export function drawEllipse(
  buffer: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: RGBA,
  filled = false,
  opacity = 1,
  outlineWidth = 1,
): void {
  const left = Math.min(Math.trunc(x0), Math.trunc(x1));
  const right = Math.max(Math.trunc(x0), Math.trunc(x1));
  const top = Math.min(Math.trunc(y0), Math.trunc(y1));
  const bottom = Math.max(Math.trunc(y0), Math.trunc(y1));
  const rx = (right - left) / 2;
  const ry = (bottom - top) / 2;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const paint = applyOpacity(color, opacity);
  if (paint.a === 0) return;

  if (rx === 0 || ry === 0) {
    bresenham(left, top, right, bottom, (x, y) => paintPixel(buffer, x, y, paint));
    return;
  }

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const normalized = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (
        filled
          ? normalized <= 1
          : normalized <= 1 && normalized >= 1 - (2 * Math.max(1, outlineWidth)) / Math.max(1, rx, ry)
      ) {
        paintPixel(buffer, x, y, paint);
      }
    }
  }
}

export function polygonVertices(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  sides: number,
  rotation = -Math.PI / 2,
): Array<{ x: number; y: number }> {
  const left = Math.min(Math.trunc(x0), Math.trunc(x1));
  const right = Math.max(Math.trunc(x0), Math.trunc(x1));
  const top = Math.min(Math.trunc(y0), Math.trunc(y1));
  const bottom = Math.max(Math.trunc(y0), Math.trunc(y1));
  const count = Math.max(3, Math.min(12, Math.round(sides)));
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  return Array.from({ length: count }, (_, i) => {
    const angle = rotation + (i * Math.PI * 2) / count;
    return {
      x: Math.round(centerX + ((right - left) / 2) * Math.cos(angle)),
      y: Math.round(centerY + ((bottom - top) / 2) * Math.sin(angle)),
    };
  });
}

export function drawPolygon(
  buffer: PixelBuffer,
  vertices: readonly { x: number; y: number }[],
  color: RGBA,
  filled = false,
  opacity = 1,
  outlineWidth = 1,
): void {
  if (vertices.length < 3) return;
  const paint = applyOpacity(color, opacity);
  if (paint.a === 0) return;

  if (filled) {
    const minY = Math.max(0, Math.min(...vertices.map((point) => point.y)));
    const maxY = Math.min(buffer.height - 1, Math.max(...vertices.map((point) => point.y)));
    for (let y = minY; y <= maxY; y++) {
      const intersections: number[] = [];
      for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const a = vertices[i];
        const b = vertices[j];
        if ((a.y > y) !== (b.y > y)) {
          intersections.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
        }
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const left = Math.max(0, Math.ceil(intersections[i]));
        const right = Math.min(buffer.width - 1, Math.floor(intersections[i + 1]));
        for (let x = left; x <= right; x++) paintPixel(buffer, x, y, paint);
      }
    }
  }

  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    drawLine(buffer, a.x, a.y, b.x, b.y, outlineWidth, color, 'square', opacity);
  }
}

export function drawTriangle(
  buffer: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: RGBA,
  filled = false,
  opacity = 1,
  outlineWidth = 1,
): void {
  const left = Math.min(Math.trunc(x0), Math.trunc(x1));
  const right = Math.max(Math.trunc(x0), Math.trunc(x1));
  const top = Math.min(Math.trunc(y0), Math.trunc(y1));
  const bottom = Math.max(Math.trunc(y0), Math.trunc(y1));
  drawPolygon(
    buffer,
    [
      { x: Math.round((left + right) / 2), y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ],
    color,
    filled,
    opacity,
    outlineWidth,
  );
}
