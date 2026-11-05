import { describe, expect, it } from 'vitest';
import {
  ZOOM_LEVELS,
  clampView,
  ensurePixelVisible,
  fitView,
  nearestZoomLevel,
  screenToPixel,
  stepZoom,
  zoomAt,
  zoomTo,
} from './viewport';

describe('viewport', () => {
  it('fitView вписывает холст целиком и центрирует', () => {
    const v = fitView(64, 64, 800, 600);
    expect(64 * v.zoom).toBeLessThanOrEqual(600 * 0.9);
    expect(v.offsetX).toBe(Math.round((800 - 64 * v.zoom) / 2));
    expect(ZOOM_LEVELS).toContain(v.zoom);
  });

  it('зум сохраняет пиксель под курсором', () => {
    const view = { zoom: 8, offsetX: 100, offsetY: 50 };
    const before = screenToPixel(view, 300, 200);
    const next = zoomAt(view, 2, 300, 200);
    expect(next.zoom).toBeGreaterThan(8);
    expect(screenToPixel(next, 300, 200)).toEqual(before);
  });

  it('границы уровней зума', () => {
    expect(stepZoom(64, 5)).toBe(64);
    expect(stepZoom(0.25, -5)).toBe(0.25);
  });

  it('nearestZoomLevel для жестов', () => {
    expect(nearestZoomLevel(7)).toBe(8);
    expect(nearestZoomLevel(0.01)).toBe(0.25);
    expect(nearestZoomLevel(1000)).toBe(64);
    expect(nearestZoomLevel(Number.NaN)).toBe(0.25);
    expect(zoomTo({ zoom: 4, offsetX: 0, offsetY: 0 }, 4, 10, 10).zoom).toBe(4);
  });

  it('ensurePixelVisible двигает вид минимально', () => {
    const view = { zoom: 10, offsetX: 0, offsetY: 0 };
    expect(ensurePixelVisible(view, 2, 2, 400, 300)).toBe(view);
    const moved = ensurePixelVisible(view, 60, 2, 400, 300);
    expect(moved.offsetX + 60 * 10 + 10).toBeLessThanOrEqual(400);
    expect(moved.offsetY).toBe(0);
  });

  it('clampView не теряет холст из виду даже в узком окне', () => {
    const v = clampView({ zoom: 8, offsetX: -99999, offsetY: 99999 }, 32, 32, 60, 40);
    expect(v.offsetX).toBeGreaterThan(-32 * 8);
    expect(v.offsetY).toBeLessThan(40);
  });
});
