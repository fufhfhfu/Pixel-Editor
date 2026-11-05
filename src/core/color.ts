import type { RGBA } from './state';

export const TRANSPARENT: RGBA = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

function byte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function rgbaToCss(color: RGBA): string {
  const alpha = Math.min(255, Math.max(0, color.a)) / 255;
  return `rgba(${byte(color.r)}, ${byte(color.g)}, ${byte(color.b)}, ${Number(alpha.toFixed(4))})`;
}

export function rgbaToHex(color: RGBA): string {
  const channel = (value: number) => byte(value).toString(16).padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

export function hexToRgba(value: string): RGBA | null {
  const hex = value.trim().replace(/^#/, '');
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;

  const expanded = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const hasAlpha = expanded.length === 8;
  const parsed = Number.parseInt(expanded.slice(0, 6), 16);
  const alpha = hasAlpha ? Number.parseInt(expanded.slice(6, 8), 16) : 255;

  return {
    r: (parsed >>> 16) & 255,
    g: (parsed >>> 8) & 255,
    b: parsed & 255,
    a: alpha,
  };
}
