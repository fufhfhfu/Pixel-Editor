import { describe, expect, it } from 'vitest';
import { PixelBuffer, type RGBA } from './state';
import {
  clearSelection,
  combineSelections,
  copySelection,
  createColorSelection,
  createEllipseSelection,
  createOpaqueSelection,
  createPolygonSelection,
  createRectSelection,
  flipClipboard,
  integerScaleClipboard,
  invertSelection,
  moveSelection,
  pasteClipboard,
  rotateClipboard,
  scaleClipboard,
  selectionBounds,
} from './selection';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const pixelAt = (buffer: PixelBuffer, x: number, y: number) => buffer.getPixel(x, y);

describe('selection masks', () => {
  it('creates clipped rectangular and elliptical masks with deterministic bounds', () => {
    const rect = createRectSelection(5, 4, -2, 1, 2, 3);
    expect(selectionBounds(rect)).toEqual({ x: 0, y: 1, width: 3, height: 3 });
    expect(rect.data.reduce((sum, value) => sum + value, 0)).toBe(9);

    const ellipse = createEllipseSelection(7, 7, 1, 1, 5, 5);
    expect(ellipse.data[3 * 7 + 3]).toBe(1);
    expect(ellipse.data[1 * 7 + 1]).toBe(0);
    expect(selectionBounds(ellipse)).toEqual({ x: 1, y: 1, width: 5, height: 5 });
  });

  it('rasterizes polygon lasso and combines/inverts selections', () => {
    const triangle = createPolygonSelection(6, 6, [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 1, y: 4 }]);
    expect(triangle.data[2 * 6 + 2]).toBe(1);
    expect(triangle.data[4 * 6 + 4]).toBe(0);

    const other = createRectSelection(6, 6, 2, 2, 4, 4);
    expect(combineSelections(null, other, 'subtract').data.reduce((sum, value) => sum + value, 0)).toBe(0);
    expect(combineSelections(null, other, 'intersect').data.reduce((sum, value) => sum + value, 0)).toBe(0);
    expect(combineSelections(null, other, 'add').data).toEqual(other.data);
    const added = combineSelections(triangle, other, 'add');
    const subtracted = combineSelections(added, other, 'subtract');
    const intersection = combineSelections(triangle, other, 'intersect');
    expect(added.data[4 * 6 + 4]).toBe(1);
    expect(subtracted.data[4 * 6 + 4]).toBe(0);
    expect(intersection.data[2 * 6 + 2]).toBe(1);
    expect(invertSelection(triangle).data[2 * 6 + 2]).toBe(0);
    expect(() => combineSelections(triangle, createRectSelection(2, 2, 0, 0, 1, 1), 'add')).toThrow();
  });

  it('handles long polygon paths without spreading coordinates onto the call stack', () => {
    const points = Array.from({ length: 20_000 }, () => ({ x: 1, y: 1 }));
    expect(() => createPolygonSelection(3, 3, points)).not.toThrow();
  });

  it('selects opaque pixels, global colors, and contiguous color regions with tolerance', () => {
    const buffer = new PixelBuffer(4, 2);
    buffer.setPixel(0, 0, RED);
    buffer.setPixel(1, 0, { r: 250, g: 5, b: 0, a: 255 });
    buffer.setPixel(3, 1, RED);
    const contiguous = createColorSelection(buffer, 0, 0, { tolerance: 5 });
    const global = createColorSelection(buffer, 0, 0, { tolerance: 5, contiguous: false });
    expect(contiguous.data[0]).toBe(1);
    expect(contiguous.data[1]).toBe(1);
    expect(contiguous.data[7]).toBe(0);
    expect(global.data[7]).toBe(1);
    expect(createOpaqueSelection(buffer).data.reduce((sum, value) => sum + value, 0)).toBe(3);
  });

  it('copies, clears, moves, and pastes pixels without losing sparse alpha', () => {
    const buffer = new PixelBuffer(6, 2);
    buffer.setPixel(1, 0, RED);
    buffer.setPixel(3, 0, BLUE);
    const selection = createRectSelection(6, 2, 1, 0, 3, 0);
    const clipboard = copySelection(buffer, selection)!;
    expect([clipboard.width, clipboard.height]).toEqual([3, 1]);
    expect(clipboard.mask).toEqual(Uint8Array.from([1, 1, 1]));

    const moved = moveSelection(buffer, selection, 1, 1);
    expect(pixelAt(buffer, 1, 0)?.a).toBe(0);
    expect(pixelAt(buffer, 2, 1)).toEqual(RED);
    expect(pixelAt(buffer, 4, 1)).toEqual(BLUE);
    expect(selectionBounds(moved)).toEqual({ x: 2, y: 1, width: 3, height: 1 });

    clearSelection(buffer, moved);
    const pastedSelection = pasteClipboard(buffer, clipboard, 0, 0);
    expect(pixelAt(buffer, 0, 0)).toEqual(RED);
    expect(pixelAt(buffer, 2, 0)).toEqual(BLUE);
    expect(selectionBounds(pastedSelection)).toEqual({ x: 0, y: 0, width: 3, height: 1 });
  });

  it('keeps painting clipped while explicit selection clear and paste bypass and restore the clip', () => {
    const buffer = new PixelBuffer(3, 1);
    buffer.setPixel(0, 0, RED);
    buffer.setPixel(2, 0, BLUE);
    buffer.setClipMask(Uint8Array.from([0, 1, 0]));
    expect(buffer.setPixel(0, 0, BLUE)).toBe(false);

    clearSelection(buffer, createRectSelection(3, 1, 0, 0, 0, 0));
    expect(buffer.getPixel(0, 0)?.a).toBe(0);
    expect(buffer.getClipMask()).toEqual(Uint8Array.from([0, 1, 0]));

    const source = new PixelBuffer(1, 1);
    source.setPixel(0, 0, RED);
    const clipboard = copySelection(source, createRectSelection(1, 1, 0, 0, 0, 0))!;
    pasteClipboard(buffer, clipboard, 2, 0);
    expect(buffer.getPixel(2, 0)).toEqual(RED);
    expect(buffer.getClipMask()).toEqual(Uint8Array.from([0, 1, 0]));
  });

  it('flips, rotates, and nearest-neighbor scales pixel clipboard data', () => {
    const buffer = new PixelBuffer(2, 2);
    buffer.setPixel(0, 0, RED);
    buffer.setPixel(1, 0, BLUE);
    const clipboard = copySelection(buffer, createRectSelection(2, 2, 0, 0, 1, 1))!;

    const flipped = flipClipboard(clipboard, true);
    expect(Array.from(flipped.pixels.slice(0, 4))).toEqual([0, 0, 255, 255]);
    const rotated = rotateClipboard(clipboard, 90);
    expect([rotated.width, rotated.height]).toEqual([2, 2]);
    expect(Array.from(rotated.pixels.slice(4, 8))).toEqual([255, 0, 0, 255]);

    const scaled = integerScaleClipboard(clipboard, 2);
    expect([scaled.width, scaled.height]).toEqual([4, 4]);
    expect(Array.from(scaled.pixels.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(scaleClipboard(clipboard, 1, 1).mask).toEqual(Uint8Array.from([1]));
    expect(() => integerScaleClipboard(clipboard, 0)).toThrow();
  });
});
