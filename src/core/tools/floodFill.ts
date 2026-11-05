import { TRANSPARENT } from '../color';
import type { PixelBuffer, RGBA } from '../state';

/**
 * Заливка связной области (4-связность) цветом color.
 * Область определяется цветом пикселя (x, y): совпадают пиксели с тем же RGBA, а все
 * полностью прозрачные пиксели считаются одним цветом независимо от спрятанного RGB.
 * Построчный алгоритм со стеком — без рекурсии, поэтому безопасен на больших холстах.
 * Возвращает true, если хоть один пиксель изменился.
 */
export function floodFill(buffer: PixelBuffer, x: number, y: number, color: RGBA): boolean {
  if (!buffer.inBounds(x, y)) return false;

  const fill = color.a === 0 ? TRANSPARENT : color;
  const { width, height, data } = buffer;
  const start = buffer.index(x, y);
  const tr = data[start];
  const tg = data[start + 1];
  const tb = data[start + 2];
  const ta = data[start + 3];
  const targetTransparent = ta === 0;

  // Цвет уже совпадает с целевым: заливать нечего (и защита от бесконечного цикла)
  if (targetTransparent) {
    if (fill.a === 0) return false;
  } else if (tr === fill.r && tg === fill.g && tb === fill.b && ta === fill.a) {
    return false;
  }

  const matches = targetTransparent
    ? (i: number): boolean => data[i + 3] === 0
    : (i: number): boolean => data[i] === tr && data[i + 1] === tg && data[i + 2] === tb && data[i + 3] === ta;

  const rowBytes = width * 4;
  const stack: number[] = [x, y];
  let minX = x;
  let maxX = x;
  let minY = y;
  let maxY = y;

  while (stack.length > 0) {
    const sy = stack.pop() as number;
    const sx = stack.pop() as number;

    let i = (sy * width + sx) * 4;
    if (!matches(i)) continue;

    // Уходим влево до границы области
    let left = sx;
    while (left > 0 && matches(i - 4)) {
      left--;
      i -= 4;
    }

    let spanAbove = false;
    let spanBelow = false;
    let cx = left;

    for (; cx < width && matches(i); cx++, i += 4) {
      buffer.capturePixel(sy * width + cx);
      data[i] = fill.r;
      data[i + 1] = fill.g;
      data[i + 2] = fill.b;
      data[i + 3] = fill.a;

      if (sy > 0) {
        const above = matches(i - rowBytes);
        if (above && !spanAbove) stack.push(cx, sy - 1);
        spanAbove = above;
      }
      if (sy < height - 1) {
        const below = matches(i + rowBytes);
        if (below && !spanBelow) stack.push(cx, sy + 1);
        spanBelow = below;
      }
    }

    if (left < minX) minX = left;
    if (cx - 1 > maxX) maxX = cx - 1;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }

  buffer.markDirtyRect(minX, minY, maxX - minX + 1, maxY - minY + 1);
  return true;
}
