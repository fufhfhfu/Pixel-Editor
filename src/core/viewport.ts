/**
 * Ядро: математика вида (зум и смещение холста).
 * Чистый TypeScript, без зависимости от Svelte и DOM.
 *
 * offsetX/offsetY: позиция левого верхнего угла холста в экранных пикселях
 * относительно области просмотра; zoom: экранных пикселей на один пиксель холста.
 */

export interface ViewState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export interface PixelPos {
  x: number;
  y: number;
  pressure?: number;
}

/** Допустимые уровни зума (шаг колеса мыши переключает соседние). */
export const ZOOM_LEVELS: readonly number[] = [
  0.25, 0.5, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64, 96, 128, 192, 256,
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function centerView(zoom: number, imgW: number, imgH: number, viewW: number, viewH: number): ViewState {
  return {
    zoom,
    offsetX: Math.round((viewW - imgW * zoom) / 2),
    offsetY: Math.round((viewH - imgH * zoom) / 2),
  };
}

/** Самый крупный зум, при котором холст целиком помещается в область просмотра. */
export function fitView(imgW: number, imgH: number, viewW: number, viewH: number, fill = 0.9): ViewState {
  let zoom = ZOOM_LEVELS[0];
  for (const level of ZOOM_LEVELS) {
    if (imgW * level <= viewW * fill && imgH * level <= viewH * fill) {
      zoom = level;
    } else {
      break;
    }
  }
  return centerView(zoom, imgW, imgH, viewW, viewH);
}

/** Сдвигает зум на steps уровней (положительное число приближает). */
export function stepZoom(zoom: number, steps: number): number {
  let nearest = 0;
  for (let i = 1; i < ZOOM_LEVELS.length; i++) {
    if (Math.abs(ZOOM_LEVELS[i] - zoom) < Math.abs(ZOOM_LEVELS[nearest] - zoom)) nearest = i;
  }
  const index = clamp(nearest + steps, 0, ZOOM_LEVELS.length - 1);
  return ZOOM_LEVELS[index];
}

/** Ближайший допустимый уровень зума к произвольному значению (сравнение в логарифмической шкале). */
export function nearestZoomLevel(zoom: number): number {
  if (!(zoom > 0)) return ZOOM_LEVELS[0];
  let best = ZOOM_LEVELS[0];
  let bestDistance = Infinity;
  for (const level of ZOOM_LEVELS) {
    const distance = Math.abs(Math.log(level / zoom));
    if (distance < bestDistance) {
      best = level;
      bestDistance = distance;
    }
  }
  return best;
}

/** Переключает на заданный зум с сохранением точки под (sx, sy) в координатах области просмотра. */
export function zoomTo(view: ViewState, zoom: number, sx: number, sy: number): ViewState {
  if (zoom === view.zoom) return view;
  const px = (sx - view.offsetX) / view.zoom;
  const py = (sy - view.offsetY) / view.zoom;
  return {
    zoom,
    offsetX: Math.round(sx - px * zoom),
    offsetY: Math.round(sy - py * zoom),
  };
}

/** Зум на steps уровней с сохранением точки под курсором. */
export function zoomAt(view: ViewState, steps: number, sx: number, sy: number): ViewState {
  return zoomTo(view, stepZoom(view.zoom, steps), sx, sy);
}

/** Сдвигает вид минимально необходимым образом, чтобы пиксель (px, py) был виден целиком. */
export function ensurePixelVisible(
  view: ViewState,
  px: number,
  py: number,
  viewW: number,
  viewH: number,
  margin = 8,
): ViewState {
  const left = view.offsetX + px * view.zoom;
  const top = view.offsetY + py * view.zoom;
  const right = left + view.zoom;
  const bottom = top + view.zoom;

  let dx = 0;
  let dy = 0;
  if (left < margin) dx = margin - left;
  else if (right > viewW - margin) dx = viewW - margin - right;
  if (top < margin) dy = margin - top;
  else if (bottom > viewH - margin) dy = viewH - margin - bottom;

  if (dx === 0 && dy === 0) return view;
  return { zoom: view.zoom, offsetX: Math.round(view.offsetX + dx), offsetY: Math.round(view.offsetY + dy) };
}

/** Экранная точка (в координатах области просмотра) → пиксель холста. Может быть вне границ. */
export function screenToPixel(view: ViewState, sx: number, sy: number): PixelPos {
  return {
    x: Math.floor((sx - view.offsetX) / view.zoom),
    y: Math.floor((sy - view.offsetY) / view.zoom),
  };
}
