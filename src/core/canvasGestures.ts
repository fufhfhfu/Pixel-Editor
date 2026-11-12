import { nearestZoomLevel, type ViewState } from './viewport';

export interface TouchPoint {
  x: number;
  y: number;
}

export interface PinchGesture {
  ids: [number, number];
  startDistance: number;
  startZoom: number;
  startMidX: number;
  startMidY: number;
  startOffsetX: number;
  startOffsetY: number;
}

export function beginPinchGesture(
  touches: ReadonlyMap<number, TouchPoint>,
  originX: number,
  originY: number,
  view: ViewState,
): PinchGesture | null {
  const [first, second] = [...touches.entries()];
  if (!first || !second) return null;
  return {
    ids: [first[0], second[0]],
    startDistance: Math.max(1, Math.hypot(first[1].x - second[1].x, first[1].y - second[1].y)),
    startZoom: view.zoom,
    startMidX: (first[1].x + second[1].x) / 2 - originX,
    startMidY: (first[1].y + second[1].y) / 2 - originY,
    startOffsetX: view.offsetX,
    startOffsetY: view.offsetY,
  };
}

export function updatePinchGesture(
  gesture: PinchGesture,
  touches: ReadonlyMap<number, TouchPoint>,
  originX: number,
  originY: number,
): ViewState | null {
  const first = touches.get(gesture.ids[0]);
  const second = touches.get(gesture.ids[1]);
  if (!first || !second) return null;

  const distance = Math.hypot(first.x - second.x, first.y - second.y);
  const midX = (first.x + second.x) / 2 - originX;
  const midY = (first.y + second.y) / 2 - originY;
  const zoom = nearestZoomLevel((gesture.startZoom * distance) / gesture.startDistance);
  const canvasX = (gesture.startMidX - gesture.startOffsetX) / gesture.startZoom;
  const canvasY = (gesture.startMidY - gesture.startOffsetY) / gesture.startZoom;

  return {
    zoom,
    offsetX: Math.round(midX - canvasX * zoom),
    offsetY: Math.round(midY - canvasY * zoom),
  };
}
