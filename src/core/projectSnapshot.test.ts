import { describe, expect, it } from 'vitest';
import { createAnimationFrame } from './animation';
import { createRasterLayer } from './layers';
import { buildProjectSnapshot } from './projectSnapshot';
import { PixelBuffer } from './state';

describe('снимок проекта редактора', () => {
  it('переносит данные холстов, слоёв и кадров в формат проекта', () => {
    const layer = createRasterLayer('layer-1', 'Слой 1', 2, 1, new Uint8ClampedArray(8));
    const frame = createAnimationFrame('frame-2', 2, 1, new Uint8ClampedArray([1, 2, 3, 255, 0, 0, 0, 0]), 150);
    const project = buildProjectSnapshot({
      buffer: layer.buffer,
      paletteId: 'pico8',
      freeColor: false,
      primary: { r: 0, g: 0, b: 0, a: 255 },
      secondary: { r: 255, g: 255, b: 255, a: 255 },
      recent: [],
      notes: 'Project notes',
      notesMetadata: { title: 'Planning', createdAt: 100, updatedAt: 200 },
      references: [],
      customPalettes: [],
      tilemap: null,
      brushes: [],
      metadata: {},
      boards: [{
        id: 'canvas-1',
        x: -3,
        y: 4,
        layers: [layer],
        groups: [],
        activeLayerId: layer.id,
        buffer: new PixelBuffer(2, 1),
      }],
      activeBoardId: 'canvas-1',
      getAnimationFrames: () => [frame],
    });

    expect(project.notes).toBe('Project notes');
    expect(project.notesMetadata).toEqual({ title: 'Planning', createdAt: 100, updatedAt: 200 });
    expect(project.canvases?.[0]).toMatchObject({
      id: 'canvas-1',
      x: -3,
      y: 4,
      width: 2,
      height: 1,
      layers: [{
        id: 'layer-1',
        animationFrames: [{
          id: 'frame-2',
          durationMs: 150,
        }],
      }],
    });
    expect(project.canvases?.[0]?.layers?.[0]?.animationFrames?.[0]?.pixels)
      .toEqual(new Uint8ClampedArray([1, 2, 3, 255, 0, 0, 0, 0]));
  });
});
