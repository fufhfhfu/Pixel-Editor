import { describe, expect, it } from 'vitest';
import { compositeLayers, createLayerGroup, createRasterLayer, updateRasterLayer } from './layers';
import { PixelBuffer, type RGBA } from './state';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };

describe('raster layer compositing', () => {
  it('composites nested groups as isolated opacity surfaces and refreshes cached dirty pixels', () => {
    const base = createRasterLayer('base', 'Base', 2, 1);
    base.buffer.setPixel(0, 0, RED);
    base.buffer.setPixel(1, 0, RED);
    const top = { ...createRasterLayer('top', 'Top', 2, 1), groupId: 'inner' };
    top.buffer.setPixel(0, 0, BLUE);
    top.buffer.setPixel(1, 0, BLUE);
    const outer = { ...createLayerGroup('outer', 'Outer'), opacity: 0.5 };
    const inner = { ...createLayerGroup('inner', 'Inner', 'outer'), opacity: 0.5 };
    const cache = new Map<string, PixelBuffer>();
    const composite = compositeLayers(2, 1, [base, top], undefined, undefined, [outer, inner], cache);

    expect(composite.getPixel(0, 0)).toEqual({ r: 191, g: 0, b: 64, a: 255 });
    expect(composite.getPixel(1, 0)).toEqual({ r: 191, g: 0, b: 64, a: 255 });
    expect(compositeLayers(
      2,
      1,
      [base, top],
      composite,
      { x: 0, y: 0, width: 1, height: 1 },
      [{ ...outer, visible: false }, inner],
      cache,
    ).getPixel(0, 0)).toEqual(RED);
    expect(composite.getPixel(1, 0)).toEqual({ r: 191, g: 0, b: 64, a: 255 });
  });

  it('composites visible layers in stack order and honours opacity and visibility', () => {
    const bottom = createRasterLayer('bottom', 'Background', 1, 1);
    bottom.buffer.setPixel(0, 0, RED);
    const top = createRasterLayer('top', 'Top', 1, 1);
    top.buffer.setPixel(0, 0, BLUE);
    const half = updateRasterLayer(top, { opacity: 0.5 });

    expect(compositeLayers(1, 1, [bottom, half]).getPixel(0, 0)).toEqual({ r: 128, g: 0, b: 128, a: 255 });
    expect(compositeLayers(1, 1, [bottom, updateRasterLayer(top, { visible: false })]).getPixel(0, 0)).toEqual(RED);
  });

  it('supports blend modes, clipping alpha, and transparent source-over', () => {
    const base = createRasterLayer('base', 'Base', 2, 1);
    base.buffer.setPixel(0, 0, RED);
    const blend = createRasterLayer('blend', 'Blend', 2, 1);
    blend.buffer.setPixel(0, 0, BLUE);
    blend.buffer.setPixel(1, 0, BLUE);
    expect(compositeLayers(2, 1, [base, updateRasterLayer(blend, { blendMode: 'multiply' })]).getPixel(0, 0))
      .toEqual({ r: 0, g: 0, b: 0, a: 255 });

    const clipped = compositeLayers(2, 1, [base, updateRasterLayer(blend, { clippingMask: true })]);
    expect(clipped.getPixel(0, 0)?.a).toBe(255);
    expect(clipped.getPixel(1, 0)?.a).toBe(0);
    expect(blend.buffer.getPixel(0, 0)?.a).toBe(255);
  });

  it('recomposites only a dirty area without double-compositing existing output', () => {
    const bottom = createRasterLayer('bottom', 'Bottom', 2, 1);
    bottom.buffer.setPixel(0, 0, RED);
    const top = createRasterLayer('top', 'Top', 2, 1);
    top.buffer.takeDirty();
    const output = compositeLayers(2, 1, [bottom, top]);
    bottom.buffer.takeDirty();

    top.buffer.setPixel(1, 0, BLUE);
    const dirty = top.buffer.takeDirty()!;
    const updated = compositeLayers(2, 1, [bottom, top], output, dirty);

    expect(updated).toBe(output);
    expect(updated.getPixel(0, 0)).toEqual(RED);
    expect(updated.getPixel(1, 0)).toEqual(BLUE);
  });

  it('respects clipping-base visibility and opacity without mutating layer pixels', () => {
    const base = createRasterLayer('base', 'Base', 1, 1);
    base.buffer.setPixel(0, 0, { ...RED, a: 128 });
    const top = createRasterLayer('top', 'Top', 1, 1);
    top.buffer.setPixel(0, 0, BLUE);
    const basePixels = base.buffer.data.slice();
    const topPixels = top.buffer.data.slice();

    const result = compositeLayers(1, 1, [
      updateRasterLayer(base, { opacity: 0.5 }),
      updateRasterLayer(top, { clippingMask: true }),
    ]);
    expect(result.getPixel(0, 0)?.a).toBe(112);
    expect(base.buffer.data).toEqual(basePixels);
    expect(top.buffer.data).toEqual(topPixels);
    expect(compositeLayers(1, 1, [
      updateRasterLayer(base, { visible: false }),
      updateRasterLayer(top, { clippingMask: true }),
    ]).getPixel(0, 0)?.a).toBe(0);
  });

  it('validates layer names and opacity and rejects mismatched or duplicate layer data', () => {
    const layer = createRasterLayer('layer', 'Layer', 1, 1);
    expect(() => updateRasterLayer(layer, { name: '  ' })).toThrow();
    expect(() => updateRasterLayer(layer, { opacity: 1.1 })).toThrow();
    expect(() => compositeLayers(1, 1, [layer, layer])).toThrow(/unique/);
    expect(() => compositeLayers(2, 1, [layer])).toThrow(/dimensions/);
  });

  it('applies non-destructive color effects and enforces non-editable layer roles', () => {
    const layer = createRasterLayer('layer', 'Layer', 1, 1);
    layer.buffer.setPixel(0, 0, { r: 100, g: 120, b: 140, a: 255 });
    const original = layer.buffer.data.slice();
    const effected = updateRasterLayer(layer, {
      effects: { brightness: 30, contrast: 0, saturation: -100 },
    });

    expect(compositeLayers(1, 1, [effected]).getPixel(0, 0)).not.toEqual(layer.buffer.getPixel(0, 0));
    expect(layer.buffer.data).toEqual(original);
    expect(updateRasterLayer(layer, { role: 'background', locked: false, alphaLock: true }))
      .toMatchObject({ role: 'background', locked: true, alphaLock: false });
    expect(updateRasterLayer(layer, { role: 'reference', locked: false, alphaLock: true }))
      .toMatchObject({ role: 'reference', locked: true, alphaLock: false });
    expect(() => updateRasterLayer(layer, { effects: { contrast: 101 } })).toThrow(/contrast/);
  });

  it('PixelBuffer lock prevents writes and alpha lock preserves existing silhouette', () => {
    const buffer = new PixelBuffer(2, 1);
    buffer.setPixel(0, 0, RED);
    buffer.setAlphaLock(true);
    buffer.setPixel(0, 0, { r: 0, g: 0, b: 255, a: 128 });
    buffer.setPixel(1, 0, BLUE);
    expect(buffer.getPixel(0, 0)).toEqual({ r: 127, g: 0, b: 128, a: 255 });
    expect(buffer.getPixel(1, 0)?.a).toBe(0);
    buffer.setLocked(true);
    expect(buffer.setPixel(0, 0, BLUE)).toBe(false);
    expect(buffer.getPixel(0, 0)).toEqual({ r: 127, g: 0, b: 128, a: 255 });
    buffer.clear();
    expect(buffer.getPixel(0, 0)).toEqual({ r: 127, g: 0, b: 128, a: 255 });
    buffer.setLocked(false);
    buffer.clear();
    expect(buffer.getPixel(0, 0)).toEqual({ r: 127, g: 0, b: 128, a: 255 });
    buffer.setAlphaLock(false);
    buffer.clear();
    expect(buffer.getPixel(0, 0)?.a).toBe(0);
  });
});
