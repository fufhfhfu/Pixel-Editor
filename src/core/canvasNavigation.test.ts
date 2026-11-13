import { describe, expect, it } from 'vitest';
import { getSceneBounds, guideBox, guideLine, snapBoardPosition } from './canvasNavigation';

describe('навигация сцены холстов', () => {
  it('считает границы расположенных холстов и использует размер активного при пустой сцене', () => {
    expect(getSceneBounds([
      { id: 'a', x: -4, y: 3, width: 10, height: 8 },
      { id: 'b', x: 12, y: -2, width: 5, height: 6 },
    ], 32, 32)).toEqual({
      minX: -4,
      minY: -2,
      maxX: 17,
      maxY: 11,
      width: 21,
      height: 13,
    });
    expect(getSceneBounds([], 16, 8)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 16,
      maxY: 8,
      width: 16,
      height: 8,
    });
  });

  it('привязывает ближайшие грани и возвращает линии выравнивания', () => {
    const moving = { id: 'moving', x: 0, y: 0, width: 10, height: 10 };
    const stationary = { id: 'stationary', x: 12, y: 0, width: 10, height: 10 };

    const result = snapBoardPosition(moving, [moving, stationary], 3, 1, 1, false, 1);

    expect(result.x).toBe(2);
    expect(result.y).toBe(0);
    expect(result.guides).toHaveLength(2);
    expect(guideBox(result.guides[0]!, 2)).toEqual({ left: 24, top: 20, width: 1, height: 1 });
    expect(guideLine(result.guides[0]!, 2)).toEqual({ x1: 0.5, y1: 0, x2: 0.5, y2: 1 });
  });

  it('исключает перемещаемые холсты и применяет привязку к сетке', () => {
    const moving = { id: 'moving', x: 0, y: 0, width: 10, height: 10 };
    const otherMoving = { id: 'moving-2', x: 20, y: 0, width: 10, height: 10 };

    expect(snapBoardPosition(
      moving,
      [moving, otherMoving],
      7,
      13,
      1,
      true,
      8,
      new Set(['moving', 'moving-2']),
    )).toEqual({ x: 8, y: 16, guides: [] });
  });
});
