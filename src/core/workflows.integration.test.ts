import { describe, expect, it } from 'vitest';
import { getPalette } from './palette';
import { compositeLayers, createRasterLayer, updateRasterLayer } from './layers';
import { History } from './history';
import { createRectSelection } from './selection';
import { PixelBuffer, type RGBA } from './state';
import { StrokeSession } from './stroke';
import { TOOLS, type ToolContext } from './tools';
import { parseProject, serializeProject, type ProjectData } from './project';
import { scaleNearest } from './export';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };

describe('editor workflows', () => {
  it('draws through a selection into one layer and preserves exact composite pixels across undo and redo', () => {
    const background = createRasterLayer('background', 'Background', 7, 3);
    for (let y = 0; y < background.buffer.height; y++) {
      for (let x = 0; x < background.buffer.width; x++) background.buffer.setPixel(x, y, BLUE);
    }
    const ink = createRasterLayer('ink', 'Ink', 7, 3);
    ink.buffer.setClipMask(createRectSelection(7, 3, 2, 1, 4, 1).data);

    const history = new History();
    const session = new StrokeSession({
      makeContext: (_slot, pressure = 1): ToolContext => ({
        buffer: ink.buffer,
        color: RED,
        brushSize: 1,
        pressure,
        invalidate() {},
        setColor() {},
      }),
      onBegin: () => history.begin(ink.buffer),
      onUseColor() {},
      onEnd: (outcome) => {
        if (outcome === 'commit') history.commit(ink.buffer);
        else history.rollback(ink.buffer);
      },
    });

    const pencil = TOOLS.find((tool) => tool.id === 'pencil')!;
    expect(session.start(1, pencil, 'primary', 0, 1)).toBe(true);
    session.move(1, [{ x: 6, y: 1 }]);
    expect(session.finish(1, { x: 6, y: 1 })).toBe(true);

    expect(Array.from({ length: 7 }, (_, x) => ink.buffer.getPixel(x, 1)?.a))
      .toEqual([0, 0, 255, 255, 255, 0, 0]);
    const afterStroke = compositeLayers(7, 3, [background, ink]).data.slice();
    expect(history.undoCount).toBe(1);

    expect(history.undo(ink.buffer)).toBe(ink.buffer);
    expect(compositeLayers(7, 3, [background, ink]).data).toEqual(background.buffer.data);

    expect(history.redo(ink.buffer)).toBe(ink.buffer);
    expect(compositeLayers(7, 3, [background, ink]).data).toEqual(afterStroke);
  });

  it('round-trips layered animation data and exports the restored composite without changing RGBA pixels', () => {
    const palette = getPalette('pico8');
    const bottomPixels = new PixelBuffer(2, 1);
    bottomPixels.setPixel(0, 0, BLUE);
    bottomPixels.setPixel(1, 0, BLUE);
    const topPixels = new PixelBuffer(2, 1);
    topPixels.setPixel(0, 0, RED);

    const project: ProjectData = {
      width: 2,
      height: 1,
      pixels: compositeLayers(2, 1, [
        createRasterLayer('bottom', 'Bottom', 2, 1, bottomPixels.data),
        createRasterLayer('top', 'Top', 2, 1, topPixels.data),
      ]).data,
      paletteId: 'pico8',
      freeColor: false,
      primary: palette.colors[8]!,
      secondary: palette.colors[7]!,
      recent: [palette.colors[8]!],
      activeCanvasId: 'canvas',
      canvases: [{
        id: 'canvas',
        x: 0,
        y: 0,
        width: 2,
        height: 1,
        pixels: compositeLayers(2, 1, [
          createRasterLayer('bottom', 'Bottom', 2, 1, bottomPixels.data),
          createRasterLayer('top', 'Top', 2, 1, topPixels.data),
        ]).data,
        activeLayerId: 'top',
        layers: [
          {
            id: 'bottom',
            name: 'Bottom',
            pixels: bottomPixels.data,
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'normal',
            alphaLock: false,
            clippingMask: false,
          },
          {
            id: 'top',
            name: 'Top',
            pixels: topPixels.data,
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'normal',
            alphaLock: false,
            clippingMask: false,
            animationFrames: [{
              id: 'cel-1',
              durationMs: 120,
              pixels: topPixels.data,
            }],
          },
        ],
      }],
    };

    const restored = parseProject(serializeProject(project));
    const canvas = restored.canvases![0]!;
    const layers = canvas.layers!.map((layer) => updateRasterLayer(
      createRasterLayer(layer.id, layer.name, canvas.width, canvas.height, layer.pixels),
      {
        visible: layer.visible,
        locked: layer.locked,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        alphaLock: layer.alphaLock,
        clippingMask: layer.clippingMask,
      },
    ));
    const composite = compositeLayers(canvas.width, canvas.height, layers);
    const exported = scaleNearest(composite, 2);

    expect(canvas.activeLayerId).toBe('top');
    expect(canvas.layers![1]!.animationFrames).toMatchObject([{ id: 'cel-1', durationMs: 120 }]);
    expect(composite.data).toEqual(new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 0, 255, 255,
    ]));
    expect(exported.width).toBe(4);
    expect(exported.height).toBe(2);
    expect(exported.data).toEqual(new Uint8ClampedArray([
      255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255,
      255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255,
    ]));
  });
});
