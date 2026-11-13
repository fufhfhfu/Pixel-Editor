export interface CanvasBoardGeometry {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AlignmentGuide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SceneBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export function getSceneBounds(
  boards: readonly CanvasBoardGeometry[],
  fallbackWidth: number,
  fallbackHeight: number,
): SceneBounds {
  if (boards.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: fallbackWidth,
      maxY: fallbackHeight,
      width: fallbackWidth,
      height: fallbackHeight,
    };
  }
  const minX = Math.min(...boards.map((board) => board.x));
  const minY = Math.min(...boards.map((board) => board.y));
  const maxX = Math.max(...boards.map((board) => board.x + board.width));
  const maxY = Math.max(...boards.map((board) => board.y + board.height));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function snapBoardPosition(
  board: CanvasBoardGeometry,
  boards: readonly CanvasBoardGeometry[],
  x: number,
  y: number,
  zoom: number,
  snapToGrid: boolean,
  gridSpacing: number,
  ignoredBoardIds: ReadonlySet<string> = new Set([board.id]),
): { x: number; y: number; guides: AlignmentGuide[] } {
  let bestX: { coordinate: number; edge: 'left' | 'right'; board: CanvasBoardGeometry; distance: number } | null = null;
  let bestY: { coordinate: number; edge: 'top' | 'bottom'; board: CanvasBoardGeometry; distance: number } | null = null;
  const threshold = Math.max(1, 8 / zoom);

  for (const other of boards) {
    if (ignoredBoardIds.has(other.id)) continue;
    for (const movingEdge of ['left', 'right'] as const) {
      const movingCoordinate = x + (movingEdge === 'right' ? board.width : 0);
      for (const stationaryEdge of ['left', 'right'] as const) {
        const coordinate = other.x + (stationaryEdge === 'right' ? other.width : 0);
        const distance = Math.abs(coordinate - movingCoordinate);
        if (distance <= threshold && (!bestX || distance < bestX.distance)) {
          bestX = { coordinate, edge: movingEdge, board: other, distance };
        }
      }
    }
    for (const movingEdge of ['top', 'bottom'] as const) {
      const movingCoordinate = y + (movingEdge === 'bottom' ? board.height : 0);
      for (const stationaryEdge of ['top', 'bottom'] as const) {
        const coordinate = other.y + (stationaryEdge === 'bottom' ? other.height : 0);
        const distance = Math.abs(coordinate - movingCoordinate);
        if (distance <= threshold && (!bestY || distance < bestY.distance)) {
          bestY = { coordinate, edge: movingEdge, board: other, distance };
        }
      }
    }
  }

  let snappedX = bestX
    ? bestX.coordinate - (bestX.edge === 'right' ? board.width : 0)
    : x;
  let snappedY = bestY
    ? bestY.coordinate - (bestY.edge === 'bottom' ? board.height : 0)
    : y;
  if (snapToGrid) {
    snappedX = Math.round(snappedX / gridSpacing) * gridSpacing;
    snappedY = Math.round(snappedY / gridSpacing) * gridSpacing;
  }
  const guides: AlignmentGuide[] = [];

  if (bestX) {
    const movingY = bestX.edge === 'left' ? snappedY : snappedY + board.height;
    const stationaryY = Math.abs(movingY - bestX.board.y) <=
        Math.abs(movingY - (bestX.board.y + bestX.board.height))
      ? bestX.board.y
      : bestX.board.y + bestX.board.height;
    guides.push({ x1: bestX.coordinate, y1: movingY, x2: bestX.coordinate, y2: stationaryY });
  }

  if (bestY) {
    const movingX = bestY.edge === 'top' ? snappedX : snappedX + board.width;
    const stationaryX = Math.abs(movingX - bestY.board.x) <=
        Math.abs(movingX - (bestY.board.x + bestY.board.width))
      ? bestY.board.x
      : bestY.board.x + bestY.board.width;
    guides.push({ x1: movingX, y1: bestY.coordinate, x2: stationaryX, y2: bestY.coordinate });
  }

  return { x: snappedX, y: snappedY, guides };
}

export function guideBox(guide: AlignmentGuide, zoom: number): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  return {
    left: Math.min(guide.x1, guide.x2) * zoom,
    top: Math.min(guide.y1, guide.y2) * zoom,
    width: Math.max(1, Math.abs(guide.x2 - guide.x1) * zoom),
    height: Math.max(1, Math.abs(guide.y2 - guide.y1) * zoom),
  };
}

export function guideLine(guide: AlignmentGuide, zoom: number): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  const box = guideBox(guide, zoom);
  if (guide.x1 === guide.x2) {
    return {
      x1: box.width / 2,
      y1: guide.y1 <= guide.y2 ? 0 : box.height,
      x2: box.width / 2,
      y2: guide.y1 <= guide.y2 ? box.height : 0,
    };
  }
  if (guide.y1 === guide.y2) {
    return {
      x1: guide.x1 <= guide.x2 ? 0 : box.width,
      y1: box.height / 2,
      x2: guide.x1 <= guide.x2 ? box.width : 0,
      y2: box.height / 2,
    };
  }
  return {
    x1: guide.x1 <= guide.x2 ? 0 : box.width,
    y1: guide.y1 <= guide.y2 ? 0 : box.height,
    x2: guide.x1 <= guide.x2 ? box.width : 0,
    y2: guide.y1 <= guide.y2 ? box.height : 0,
  };
}
