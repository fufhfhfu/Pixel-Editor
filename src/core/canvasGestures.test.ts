import { describe, expect, it } from 'vitest';
import { beginPinchGesture, updatePinchGesture } from './canvasGestures';

describe('pinch-жест холста', () => {
  it('масштабирует и панорамирует вокруг исходной точки между пальцами', () => {
    const touches = new Map([
      [1, { x: 100, y: 100 }],
      [2, { x: 200, y: 100 }],
    ]);
    const gesture = beginPinchGesture(touches, 10, 20, {
      zoom: 1,
      offsetX: 5,
      offsetY: 6,
    })!;

    touches.set(1, { x: 100, y: 120 });
    touches.set(2, { x: 240, y: 120 });
    const updated = updatePinchGesture(gesture, touches, 10, 20)!;
    const currentMidX = 160;
    const currentMidY = 100;
    const startCanvasX = (gesture.startMidX - gesture.startOffsetX) / gesture.startZoom;
    const startCanvasY = (gesture.startMidY - gesture.startOffsetY) / gesture.startZoom;

    expect((currentMidX - updated.offsetX) / updated.zoom).toBeCloseTo(startCanvasX);
    expect((currentMidY - updated.offsetY) / updated.zoom).toBeCloseTo(startCanvasY);
  });

  it('не создаёт или не обновляет жест без двух активных касаний', () => {
    expect(beginPinchGesture(new Map([[1, { x: 0, y: 0 }]]), 0, 0, {
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
    })).toBeNull();

    expect(updatePinchGesture({
      ids: [1, 2],
      startDistance: 1,
      startZoom: 1,
      startMidX: 0,
      startMidY: 0,
      startOffsetX: 0,
      startOffsetY: 0,
    }, new Map([[1, { x: 0, y: 0 }]]), 0, 0)).toBeNull();
  });
});
