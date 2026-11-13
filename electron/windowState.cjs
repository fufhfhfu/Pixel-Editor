const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 920;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

function isValidBounds(value) {
  return typeof value === 'object' &&
    value !== null &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0 &&
    Number.isFinite(value.x + value.width) &&
    Number.isFinite(value.y + value.height);
}

function isValidWindowState(value) {
  return typeof value === 'object' &&
    value !== null &&
    value.version === 1 &&
    isValidBounds(value.bounds) &&
    typeof value.maximized === 'boolean';
}

function isValidWorkArea(value) {
  return isValidBounds(value) &&
    Number.isFinite(value.x + value.width) &&
    Number.isFinite(value.y + value.height);
}

function intersectionArea(bounds, area) {
  const width = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x));
  const height = Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
  return width * height;
}

function distanceToArea(bounds, area) {
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const nearestX = Math.max(area.x, Math.min(x, area.x + area.width));
  const nearestY = Math.max(area.y, Math.min(y, area.y + area.height));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2;
}

function restoreWindowState(state, workAreas) {
  const areas = workAreas.filter(isValidWorkArea);
  const fallbackArea = areas[0] ?? { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  const saved = isValidWindowState(state) ? state : null;

  let area = fallbackArea;
  if (saved) {
    area = areas.reduce((closest, candidate) => {
      const currentIntersection = intersectionArea(saved.bounds, closest);
      const candidateIntersection = intersectionArea(saved.bounds, candidate);
      if (candidateIntersection > currentIntersection) return candidate;
      if (currentIntersection > 0 || candidateIntersection > 0) return closest;
      return distanceToArea(saved.bounds, candidate) < distanceToArea(saved.bounds, closest)
        ? candidate
        : closest;
    }, fallbackArea);
  }

  const bounds = saved?.bounds ?? {
    x: area.x,
    y: area.y,
    width: Math.min(DEFAULT_WIDTH, area.width),
    height: Math.min(DEFAULT_HEIGHT, area.height),
  };
  const width = Math.max(Math.min(MIN_WIDTH, area.width), Math.min(Math.round(bounds.width), area.width));
  const height = Math.max(Math.min(MIN_HEIGHT, area.height), Math.min(Math.round(bounds.height), area.height));
  const x = Math.max(area.x, Math.min(Math.round(bounds.x), area.x + area.width - width));
  const y = Math.max(area.y, Math.min(Math.round(bounds.y), area.y + area.height - height));

  return {
    bounds: { x, y, width, height },
    maximized: saved?.maximized ?? false,
    minWidth: Math.min(MIN_WIDTH, width),
    minHeight: Math.min(MIN_HEIGHT, height),
  };
}

module.exports = { isValidWindowState, restoreWindowState };
