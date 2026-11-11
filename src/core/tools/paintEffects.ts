import type { PixelBuffer, RGBA } from '../state';

export type GradientKind = 'linear' | 'radial';
export type DitherPattern = 'checkerboard' | 'bayer2' | 'bayer4' | 'bayer8' | 'diagonal' | 'custom';

export interface GradientStop {
  position: number;
  color: RGBA;
}

export interface GradientOptions {
  kind?: GradientKind;
  stops?: readonly GradientStop[];
  dither?: boolean;
}

const BAYER_2 = [[0, 2], [3, 1]];
const BAYER_4 = [
  [0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5],
];
const BAYER_8 = BAYER_4.flatMap((row) =>
  [0, 1].map((half) => [
    ...row.map((value) => value * 4 + (half === 0 ? 0 : 2)),
    ...row.map((value) => value * 4 + (half === 0 ? 3 : 1)),
  ]),
);
const CUSTOM_MAX_CACHE = new WeakMap<object, number>();

function interpolate(a: RGBA, b: RGBA, amount: number): RGBA {
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
    a: Math.round(a.a + (b.a - a.a) * t),
  };
}

function sampleStops(stops: readonly GradientStop[], amount: number): RGBA {
  if (stops.length === 0) throw new RangeError('A gradient needs at least one color stop.');
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const t = Math.max(0, Math.min(1, amount));
  const upper = sorted.findIndex((stop) => stop.position >= t);
  if (upper < 0) return sorted.at(-1)!.color;
  if (upper === 0) return sorted[0].color;
  const before = sorted[upper - 1];
  const after = sorted[upper];
  const span = after.position - before.position;
  return interpolate(before.color, after.color, span === 0 ? 1 : (t - before.position) / span);
}

function ditherStops(stops: readonly GradientStop[], amount: number, x: number, y: number): RGBA {
  const t = Math.max(0, Math.min(1, amount));
  const upper = stops.findIndex((stop) => stop.position >= t);
  if (upper <= 0) return stops[upper < 0 ? stops.length - 1 : 0].color;
  const lower = stops[upper - 1];
  const higher = stops[upper];
  const span = higher.position - lower.position;
  const fraction = span === 0 ? 1 : (t - lower.position) / span;
  const threshold = BAYER_4[((y % 4) + 4) % 4][((x % 4) + 4) % 4] / 16;
  return fraction > threshold ? higher.color : lower.color;
}

export function paintGradient(
  buffer: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: readonly GradientStop[],
  options: GradientOptions = {},
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy;
  const kind = options.kind ?? 'linear';
  const minX = Math.max(0, Math.min(x0, x1));
  const maxX = Math.min(buffer.width - 1, Math.max(x0, x1));
  const minY = Math.max(0, Math.min(y0, y1));
  const maxY = Math.min(buffer.height - 1, Math.max(y0, y1));
  const sortedStops = [...stops].sort((a, b) => a.position - b.position);
  if (sortedStops.length === 0) throw new RangeError('A gradient needs at least one color stop.');

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const relativeX = x - x0;
      const relativeY = y - y0;
      const amount = kind === 'radial'
        ? Math.hypot(relativeX, relativeY) / Math.max(1, Math.hypot(dx, dy))
        : lengthSquared === 0
          ? 0
          : (relativeX * dx + relativeY * dy) / lengthSquared;
      let color = sampleStops(sortedStops, amount);
      if (options.dither && sortedStops.length > 1) color = ditherStops(sortedStops, amount, x, y);
      buffer.setPixel(x, y, color);
    }
  }
}

export function ditherThreshold(
  x: number,
  y: number,
  pattern: DitherPattern,
  scale = 1,
  customPattern: readonly (readonly number[])[] = [[0, 1], [1, 0]],
  angle: 0 | 45 | 90 | 135 = 0,
): number {
  const size = Math.max(1, Math.round(scale));
  let rotatedX = x;
  let rotatedY = y;
  if (angle === 45 || angle === 135) {
    const diagonal = Math.SQRT1_2;
    rotatedX = angle === 45 ? (x + y) * diagonal : (-x + y) * diagonal;
    rotatedY = angle === 45 ? (-x + y) * diagonal : (-x - y) * diagonal;
  } else if (angle === 90) {
    rotatedX = y;
    rotatedY = -x;
  }
  const px = Math.floor(rotatedX / size);
  const py = Math.floor(rotatedY / size);
  if (pattern === 'checkerboard') return ((px + py) % 2 + 2) % 2;
  if (pattern === 'diagonal') return ((px + py) % 4 + 4) % 4 < 2 ? 0 : 1;
  const matrix = pattern === 'bayer2'
    ? BAYER_2
    : pattern === 'bayer8'
      ? BAYER_8
      : pattern === 'custom'
        ? customPattern
        : BAYER_4;
  const rows = matrix.length;
  const columns = matrix[0]?.length ?? 0;
  if (rows === 0 || columns === 0) throw new RangeError('Custom dither pattern cannot be empty.');
  const value = matrix[((py % rows) + rows) % rows][((px % columns) + columns) % columns];
  let maxValue: number;
  if (pattern === 'custom') {
    const key = matrix as object;
    const cached = CUSTOM_MAX_CACHE.get(key);
    if (cached !== undefined) maxValue = cached;
    else {
      maxValue = 0;
      for (const row of matrix) for (const entry of row) maxValue = Math.max(maxValue, entry);
      CUSTOM_MAX_CACHE.set(key, maxValue);
    }
  } else {
    maxValue = pattern === 'bayer2' ? 3 : pattern === 'bayer8' ? 63 : 15;
  }
  return value / (maxValue + 1);
}

export function parseCustomDitherPattern(pattern: string): number[][] {
  const rows = pattern.trim().split(/[\/\n]/);
  if (rows.length === 0 || rows.length > 8) throw new RangeError('A custom dither pattern must have 1–8 rows.');
  const width = rows[0].length;
  if (width < 1 || width > 8 || rows.some((row) => row.length !== width || !/^[0-9]+$/.test(row))) {
    throw new TypeError('Use a rectangular pattern of 1–8 digit characters per row.');
  }
  return rows.map((row) => [...row].map(Number));
}

export function applyDither(
  buffer: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  foreground: RGBA,
  background: RGBA,
  options: {
    pattern?: DitherPattern;
    density?: number;
    scale?: number;
    customPattern?: readonly (readonly number[])[];
    angle?: 0 | 45 | 90 | 135;
  } = {},
): void {
  const left = Math.max(0, Math.min(x0, x1));
  const right = Math.min(buffer.width - 1, Math.max(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const bottom = Math.min(buffer.height - 1, Math.max(y0, y1));
  const density = Math.max(0, Math.min(1, options.density ?? 0.5));
  const pattern = options.pattern ?? 'bayer4';
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const threshold = ditherThreshold(x, y, pattern, options.scale, options.customPattern, options.angle);
      buffer.setPixel(x, y, density >= 1 || (density > 0 && threshold < density) ? foreground : background);
    }
  }
}

export function fillShape(
  buffer: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: RGBA,
): void {
  const left = Math.max(0, Math.min(x0, x1));
  const right = Math.min(buffer.width - 1, Math.max(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const bottom = Math.min(buffer.height - 1, Math.max(y0, y1));
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) buffer.setPixel(x, y, color);
  }
}
