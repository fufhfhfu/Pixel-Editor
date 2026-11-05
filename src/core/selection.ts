import { MAX_GRID_PIXELS, type PixelBuffer, type RGBA } from './state';

export type SelectionOperation = 'replace' | 'add' | 'subtract' | 'intersect';
export type SelectionMode = 'rect' | 'ellipse' | 'lasso' | 'polygon' | 'wand' | 'color';

export interface SelectionMask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface SelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelClipboard {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
  readonly mask: Uint8Array;
}

export interface SelectionOptions {
  tolerance?: number;
  connectivity?: 4 | 8;
  contiguous?: boolean;
}

function assertDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_GRID_PIXELS
  ) {
    throw new RangeError(`Selection dimensions must be positive integers with an area no greater than ${MAX_GRID_PIXELS}.`);
  }
}

function emptyMask(width: number, height: number): SelectionMask {
  assertDimensions(width, height);
  return { width, height, data: new Uint8Array(width * height) };
}

function sameDimensions(a: SelectionMask, b: SelectionMask): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new RangeError('Selection masks must have matching dimensions.');
  }
}

export function createRectSelection(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): SelectionMask {
  const mask = emptyMask(width, height);
  const left = Math.max(0, Math.min(Math.trunc(x0), Math.trunc(x1)));
  const right = Math.min(width - 1, Math.max(Math.trunc(x0), Math.trunc(x1)));
  const top = Math.max(0, Math.min(Math.trunc(y0), Math.trunc(y1)));
  const bottom = Math.min(height - 1, Math.max(Math.trunc(y0), Math.trunc(y1)));
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) mask.data[y * width + x] = 1;
  }
  return mask;
}

export function createEllipseSelection(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): SelectionMask {
  const mask = emptyMask(width, height);
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const radiusX = Math.max(0.5, (right - left + 1) / 2);
  const radiusY = Math.max(0.5, (bottom - top + 1) / 2);
  const xStart = Math.max(0, Math.floor(left));
  const xEnd = Math.min(width - 1, Math.ceil(right));
  const yStart = Math.max(0, Math.floor(top));
  const yEnd = Math.min(height - 1, Math.ceil(bottom));
  for (let y = yStart; y <= yEnd; y++) {
    for (let x = xStart; x <= xEnd; x++) {
      const dx = (x - centerX) / radiusX;
      const dy = (y - centerY) / radiusY;
      if (dx * dx + dy * dy <= 1) mask.data[y * width + x] = 1;
    }
  }
  return mask;
}

export function createPolygonSelection(
  width: number,
  height: number,
  points: readonly { x: number; y: number }[],
): SelectionMask {
  const mask = emptyMask(width, height);
  if (points.length < 3) return mask;
  let minPointX = Infinity;
  let maxPointX = -Infinity;
  let minPointY = Infinity;
  let maxPointY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new TypeError('Polygon points must contain finite coordinates.');
    }
    minPointX = Math.min(minPointX, point.x);
    maxPointX = Math.max(maxPointX, point.x);
    minPointY = Math.min(minPointY, point.y);
    maxPointY = Math.max(maxPointY, point.y);
  }
  const minX = Math.max(0, Math.floor(minPointX));
  const maxX = Math.min(width - 1, Math.ceil(maxPointX));
  const minY = Math.max(0, Math.floor(minPointY));
  const maxY = Math.min(height - 1, Math.ceil(maxPointY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let isInside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i];
        const b = points[j];
        const crosses = (a.y > y) !== (b.y > y) &&
          x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
        if (crosses) isInside = !isInside;
      }
      if (isInside) mask.data[y * width + x] = 1;
    }
  }
  return mask;
}

export function createOpaqueSelection(buffer: PixelBuffer): SelectionMask {
  const mask = emptyMask(buffer.width, buffer.height);
  for (let pixel = 0; pixel < mask.data.length; pixel++) {
    mask.data[pixel] = buffer.data[pixel * 4 + 3] > 0 ? 1 : 0;
  }
  return mask;
}

function colorMatches(buffer: PixelBuffer, pixel: number, target: RGBA, tolerance: number): boolean {
  const offset = pixel * 4;
  const alpha = buffer.data[offset + 3];
  if (target.a === 0) return alpha === 0;
  return alpha > 0 &&
    Math.abs(buffer.data[offset] - target.r) <= tolerance &&
    Math.abs(buffer.data[offset + 1] - target.g) <= tolerance &&
    Math.abs(buffer.data[offset + 2] - target.b) <= tolerance &&
    Math.abs(alpha - target.a) <= tolerance;
}

export function createColorSelection(
  buffer: PixelBuffer,
  x: number,
  y: number,
  options: SelectionOptions = {},
): SelectionMask {
  const mask = emptyMask(buffer.width, buffer.height);
  if (!buffer.inBounds(x, y)) return mask;
  const tolerance = Math.max(0, Math.min(255, Math.round(options.tolerance ?? 0)));
  const start = y * buffer.width + x;
  const offset = start * 4;
  const target = { r: buffer.data[offset], g: buffer.data[offset + 1], b: buffer.data[offset + 2], a: buffer.data[offset + 3] };
  const matches = (pixel: number) => colorMatches(buffer, pixel, target, tolerance);
  if (options.contiguous === false) {
    for (let pixel = 0; pixel < mask.data.length; pixel++) {
      if (matches(pixel)) mask.data[pixel] = 1;
    }
    return mask;
  }
  const connectivity = options.connectivity ?? 4;
  const neighbors = connectivity === 8
    ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const
    : [[0, -1], [-1, 0], [1, 0], [0, 1]] as const;
  const visited = new Uint8Array(mask.data.length);
  const queue = new Uint32Array(mask.data.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  visited[start] = 1;
  while (head < tail) {
    const pixel = queue[head++];
    if (!matches(pixel)) continue;
    mask.data[pixel] = 1;
    const px = pixel % buffer.width;
    const py = Math.floor(pixel / buffer.width);
    for (const [dx, dy] of neighbors) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || nx >= buffer.width || ny < 0 || ny >= buffer.height) continue;
      const next = ny * buffer.width + nx;
      if (visited[next]) continue;
      visited[next] = 1;
      if (matches(next)) queue[tail++] = next;
    }
  }
  return mask;
}

export function combineSelections(
  current: SelectionMask | null,
  next: SelectionMask,
  operation: SelectionOperation,
): SelectionMask {
  if (operation === 'replace') {
    return { width: next.width, height: next.height, data: new Uint8Array(next.data) };
  }
  if (current === null) {
    return operation === 'add'
      ? { width: next.width, height: next.height, data: new Uint8Array(next.data) }
      : emptyMask(next.width, next.height);
  }
  sameDimensions(current, next);
  const data = new Uint8Array(current.data.length);
  for (let i = 0; i < data.length; i++) {
    const a = current.data[i] !== 0;
    const b = next.data[i] !== 0;
    data[i] = operation === 'add' ? Number(a || b)
      : operation === 'subtract' ? Number(a && !b)
        : Number(a && b);
  }
  return { width: current.width, height: current.height, data };
}

export function invertSelection(selection: SelectionMask): SelectionMask {
  return {
    width: selection.width,
    height: selection.height,
    data: Uint8Array.from(selection.data, (value) => value ? 0 : 1),
  };
}

export function selectionBounds(selection: SelectionMask): SelectionBounds | null {
  let minX = selection.width;
  let minY = selection.height;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < selection.data.length; pixel++) {
    if (!selection.data[pixel]) continue;
    const x = pixel % selection.width;
    const y = Math.floor(pixel / selection.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function copySelection(buffer: PixelBuffer, selection: SelectionMask): PixelClipboard | null {
  if (selection.width !== buffer.width || selection.height !== buffer.height) {
    throw new RangeError('Selection dimensions must match the pixel buffer.');
  }
  const bounds = selectionBounds(selection);
  if (!bounds) return null;
  const pixels = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  const mask = new Uint8Array(bounds.width * bounds.height);
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const source = (bounds.y + y) * buffer.width + bounds.x + x;
      const target = y * bounds.width + x;
      if (!selection.data[source]) continue;
      mask[target] = 1;
      pixels.set(buffer.data.subarray(source * 4, source * 4 + 4), target * 4);
    }
  }
  return { width: bounds.width, height: bounds.height, pixels, mask };
}

export function clearSelection(buffer: PixelBuffer, selection: SelectionMask): void {
  if (selection.width !== buffer.width || selection.height !== buffer.height) {
    throw new RangeError('Selection dimensions must match the pixel buffer.');
  }
  const previousClip = buffer.getClipMask();
  buffer.setClipMask(null);
  try {
    for (let pixel = 0; pixel < selection.data.length; pixel++) {
      if (selection.data[pixel]) buffer.setPixel(pixel % buffer.width, Math.floor(pixel / buffer.width), { r: 0, g: 0, b: 0, a: 0 });
    }
  } finally {
    buffer.setClipMask(previousClip);
  }
}

export function pasteClipboard(buffer: PixelBuffer, clipboard: PixelClipboard, x: number, y: number): SelectionMask {
  const mask = emptyMask(buffer.width, buffer.height);
  if (clipboard.pixels.length !== clipboard.width * clipboard.height * 4 ||
    clipboard.mask.length !== clipboard.width * clipboard.height) {
    throw new RangeError('Clipboard data does not match its dimensions.');
  }
  const previousClip = buffer.getClipMask();
  buffer.setClipMask(null);
  try {
    for (let cy = 0; cy < clipboard.height; cy++) {
      for (let cx = 0; cx < clipboard.width; cx++) {
        if (!clipboard.mask[cy * clipboard.width + cx]) continue;
        const px = x + cx;
        const py = y + cy;
        if (!buffer.inBounds(px, py)) continue;
        const pixel = cy * clipboard.width + cx;
        const offset = pixel * 4;
        buffer.setPixel(px, py, {
          r: clipboard.pixels[offset],
          g: clipboard.pixels[offset + 1],
          b: clipboard.pixels[offset + 2],
          a: clipboard.pixels[offset + 3],
        });
        mask.data[py * buffer.width + px] = 1;
      }
    }
  } finally {
    buffer.setClipMask(previousClip);
  }
  return mask;
}

export function moveSelection(
  buffer: PixelBuffer,
  selection: SelectionMask,
  dx: number,
  dy: number,
): SelectionMask {
  const clipboard = copySelection(buffer, selection);
  if (!clipboard) return emptyMask(buffer.width, buffer.height);
  const bounds = selectionBounds(selection)!;
  clearSelection(buffer, selection);
  return pasteClipboard(buffer, clipboard, bounds.x + Math.trunc(dx), bounds.y + Math.trunc(dy));
}

export function scaleClipboard(clipboard: PixelClipboard, width: number, height: number): PixelClipboard {
  assertDimensions(clipboard.width, clipboard.height);
  assertDimensions(width, height);
  if (clipboard.pixels.length !== clipboard.width * clipboard.height * 4 ||
    clipboard.mask.length !== clipboard.width * clipboard.height) {
    throw new RangeError('Clipboard data does not match its dimensions.');
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(clipboard.height - 1, Math.floor((y * clipboard.height) / height));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(clipboard.width - 1, Math.floor((x * clipboard.width) / width));
      const source = sourceY * clipboard.width + sourceX;
      const target = y * width + x;
      if (!clipboard.mask[source]) continue;
      mask[target] = 1;
      pixels.set(clipboard.pixels.subarray(source * 4, source * 4 + 4), target * 4);
    }
  }
  return { width, height, pixels, mask };
}

export function integerScaleClipboard(clipboard: PixelClipboard, factor: number): PixelClipboard {
  if (!Number.isInteger(factor) || factor < 1) throw new RangeError('Integer scale factor must be a positive integer.');
  return scaleClipboard(clipboard, clipboard.width * factor, clipboard.height * factor);
}

export function flipClipboard(clipboard: PixelClipboard, horizontal: boolean): PixelClipboard {
  const pixels = new Uint8ClampedArray(clipboard.pixels.length);
  const mask = new Uint8Array(clipboard.mask.length);
  for (let y = 0; y < clipboard.height; y++) {
    for (let x = 0; x < clipboard.width; x++) {
      const source = y * clipboard.width + x;
      const targetX = horizontal ? clipboard.width - 1 - x : x;
      const targetY = horizontal ? y : clipboard.height - 1 - y;
      const target = targetY * clipboard.width + targetX;
      mask[target] = clipboard.mask[source];
      pixels.set(clipboard.pixels.subarray(source * 4, source * 4 + 4), target * 4);
    }
  }
  return { width: clipboard.width, height: clipboard.height, pixels, mask };
}

export function rotateClipboard(clipboard: PixelClipboard, degrees: number): PixelClipboard {
  assertDimensions(clipboard.width, clipboard.height);
  if (!Number.isFinite(degrees)) throw new TypeError('Rotation must be a finite number.');
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const width = Math.max(1, Math.ceil(Math.abs(clipboard.width * cosine) + Math.abs(clipboard.height * sine)));
  const height = Math.max(1, Math.ceil(Math.abs(clipboard.width * sine) + Math.abs(clipboard.height * cosine)));
  assertDimensions(width, height);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const mask = new Uint8Array(width * height);
  const sourceCenterX = (clipboard.width - 1) / 2;
  const sourceCenterY = (clipboard.height - 1) / 2;
  const targetCenterX = (width - 1) / 2;
  const targetCenterY = (height - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - targetCenterX;
      const dy = y - targetCenterY;
      const sourceX = Math.round(dx * cosine + dy * sine + sourceCenterX);
      const sourceY = Math.round(-dx * sine + dy * cosine + sourceCenterY);
      if (sourceX < 0 || sourceX >= clipboard.width || sourceY < 0 || sourceY >= clipboard.height) continue;
      const source = sourceY * clipboard.width + sourceX;
      const target = y * width + x;
      mask[target] = clipboard.mask[source];
      pixels.set(clipboard.pixels.subarray(source * 4, source * 4 + 4), target * 4);
    }
  }
  return { width, height, pixels, mask };
}
