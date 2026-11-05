import { describe, expect, it } from 'vitest';
import { PixelBuffer, type RGBA } from './state';
import { createBrushDefinition, TOOLS, type BrushDefinition, type ToolContext, type ToolId } from './tools';
import { bresenham, isPixelPerfectCorner, stampSquare } from './tools/draw';
import { floodFill } from './tools/floodFill';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };

const tool = (id: ToolId) => {
  const found = TOOLS.find((t) => t.id === id);
  if (!found) throw new Error(id);
  return found;
};

function ctxOf(
  buffer: PixelBuffer,
  color = RED,
  brushSize = 1,
  options: {
    brushShape?: 'square' | 'circle';
    opacity?: number;
    pressure?: number;
    pixelPerfect?: boolean;
    brushDefinition?: BrushDefinition;
  } = {},
) {
  let invalidated = 0;
  let picked: RGBA | null = null;
  const ctx: ToolContext = {
    buffer,
    color,
    brushSize,
    brushShape: options.brushShape,
    opacity: options.opacity,
    pressure: options.pressure,
    brushDefinition: options.brushDefinition,
    settings: options.pixelPerfect === undefined
      ? undefined
      : {
          pixelPerfect: options.pixelPerfect,
          lineAngleSnap: 0,
          fillContiguous: true,
          fillTolerance: 0,
          fillConnectivity: 4,
          fillProtectAlpha: false,
          sampleMerged: false,
          pickerRadius: 1,
          polygonSides: 6,
          gradientKind: 'linear',
          gradientDither: false,
          gradientTransparency: false,
          gradientMidpointEnabled: false,
          gradientMidpoint: RED,
          gradientMidpointPosition: 50,
          ditherPattern: 'bayer4',
          ditherDensity: 0.5,
          ditherScale: 1,
          ditherAngle: 0,
          ditherCustomPattern: '01/10',
        },
    invalidate: () => invalidated++,
    setColor: (c) => (picked = c),
  };
  return { ctx, invalidated: () => invalidated, picked: () => picked };
}

const countWhere = (b: PixelBuffer, pred: (p: RGBA) => boolean) => {
  let n = 0;
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (pred(b.getPixel(x, y) as RGBA)) n++;
  return n;
};
const opaque = (p: RGBA) => p.a > 0;

describe('Брезенхэм', () => {
  it.each([
    [0, 0, 10, 3],
    [10, 3, 0, 0],
    [0, 0, 3, 10],
    [5, 5, 5, 5],
    [0, 9, 9, 0],
    [-3, -2, 4, 6],
  ])('линия (%i,%i)–(%i,%i) без разрывов и пропусков', (x0, y0, x1, y1) => {
    const pts: number[][] = [];
    bresenham(x0, y0, x1, y1, (x, y) => pts.push([x, y]));
    expect(pts[0]).toEqual([x0, y0]);
    expect(pts.at(-1)).toEqual([x1, y1]);
    expect(pts.length).toBe(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1);
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i][0] - pts[i - 1][0])).toBeLessThanOrEqual(1);
      expect(Math.abs(pts[i][1] - pts[i - 1][1])).toBeLessThanOrEqual(1);
    }
  });
});

describe('Кисть', () => {
  it.each([1, 2, 3, 4])('размер %i закрашивает size² пикселей', (size) => {
    const b = new PixelBuffer(16, 16);
    stampSquare(b, 8, 8, size, RED);
    expect(countWhere(b, opaque)).toBe(size * size);
  });

  it('у края холста лишнее отбрасывается', () => {
    const b = new PixelBuffer(16, 16);
    stampSquare(b, 0, 0, 4, RED);
    expect(countWhere(b, opaque)).toBe(9);
  });

  it('поддерживает размер 64 без потери пикселей', () => {
    const b = new PixelBuffer(80, 80);
    stampSquare(b, 40, 40, 64, RED);
    expect(countWhere(b, opaque)).toBe(64 * 64);
  });

  it('круглый отпечаток не закрашивает углы квадратной рамки', () => {
    const b = new PixelBuffer(16, 16);
    const { ctx } = ctxOf(b, RED, 4, { brushShape: 'circle' });
    tool('pencil').begin(ctx, 8, 8);
    expect(countWhere(b, opaque)).toBe(12);
    expect(b.getPixel(8, 7)?.a).toBe(255);
    expect(b.getPixel(6, 6)?.a).toBe(0);
  });

  it('непрозрачность рисования задаёт альфу пикселя', () => {
    const b = new PixelBuffer(8, 8);
    const { ctx } = ctxOf(b, RED, 1, { opacity: 0.5 });
    tool('pencil').begin(ctx, 3, 3);
    expect(b.getPixel(3, 3)?.a).toBe(128);
  });

  it('давление пера масштабирует размер кисти даже без смены пиксельной позиции', () => {
    const b = new PixelBuffer(16, 16);
    const pencil = tool('pencil');
    pencil.begin(ctxOf(b, RED, 4, { pressure: 0.5 }).ctx, 8, 8);
    expect(countWhere(b, opaque)).toBe(4);
  });

  it('ластик с неполной непрозрачностью постепенно уменьшает альфу', () => {
    const b = new PixelBuffer(8, 8);
    b.setPixel(3, 3, RED);
    const eraser = tool('eraser');
    eraser.begin(ctxOf(b, RED, 1, { opacity: 0.5 }).ctx, 3, 3);
    expect(b.getPixel(3, 3)?.a).toBe(128);
    eraser.begin(ctxOf(b, RED, 1, { opacity: 0.5 }).ctx, 3, 3);
    expect(b.getPixel(3, 3)?.a).toBe(64);
  });

  it('нулевая непрозрачность не рисует и не стирает', () => {
    const b = new PixelBuffer(8, 8);
    const pencil = tool('pencil');
    pencil.begin(ctxOf(b, RED, 1, { opacity: 0 }).ctx, 3, 3);
    expect(b.getPixel(3, 3)?.a).toBe(0);
    b.setPixel(3, 3, RED);
    tool('eraser').begin(ctxOf(b, RED, 1, { opacity: 0 }).ctx, 3, 3);
    expect(b.getPixel(3, 3)).toEqual(RED);
  });

  it('Pixel Perfect пропускает ортогональный угол-пиксель и сохраняет диагональные концы', () => {
    const b = new PixelBuffer(8, 8);
    const pencil = tool('pencil');
    const { ctx } = ctxOf(b, RED, 1, { pixelPerfect: true });
    pencil.begin(ctx, 1, 1);
    pencil.move?.(ctx, 2, 1);
    pencil.move?.(ctx, 2, 2);
    pencil.end?.(ctx, 2, 2);
    expect(isPixelPerfectCorner({ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 })).toBe(true);
    expect(b.getPixel(1, 1)?.a).toBe(255);
    expect(b.getPixel(2, 1)?.a).toBe(0);
    expect(b.getPixel(2, 2)?.a).toBe(255);
  });
});

describe('Свободное рисование', () => {
  it('быстрый штрих без разрывов', () => {
    const b = new PixelBuffer(32, 32);
    const { ctx } = ctxOf(b);
    const pencil = tool('pencil');
    pencil.begin(ctx, 2, 2);
    pencil.move?.(ctx, 25, 9);
    pencil.end?.(ctx, 25, 9);
    expect(countWhere(b, opaque)).toBe(24);
  });

  it('штрих, ушедший за холст и вернувшийся, не падает и рисует внутри', () => {
    const b = new PixelBuffer(16, 16);
    const { ctx } = ctxOf(b, RED, 3);
    const pencil = tool('pencil');
    pencil.begin(ctx, 5, 5);
    pencil.move?.(ctx, -40, 100);
    pencil.end?.(ctx, 70, -20);
    expect(countWhere(b, opaque)).toBeGreaterThan(0);
  });

  it('ластик стирает кистью заданного размера', () => {
    const b = new PixelBuffer(16, 16);
    const { ctx } = ctxOf(b, RED, 2);
    tool('fill').begin(ctx, 0, 0);
    tool('eraser').begin(ctx, 4, 4);
    tool('eraser').end?.(ctx, 4, 4);
    expect(countWhere(b, opaque)).toBe(256 - 4);
  });

  it('ластик использует маску и настройки пользовательской кисти', () => {
    const b = new PixelBuffer(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) b.setPixel(x, y, RED);
    const brush = createBrushDefinition('Round eraser', 4, 'circle');
    const { ctx } = ctxOf(b, RED, 4, { brushDefinition: brush });
    tool('eraser').begin(ctx, 8, 8);
    expect(b.getPixel(8, 8)?.a).toBe(0);
    expect(b.getPixel(6, 6)).toEqual(RED);
  });

  it('разрывов нет при редких событиях: 2400 случайных штрихов, все кисти', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    let gaps = 0;
    let segments = 0;

    for (const id of ['pencil', 'eraser'] as const) {
      for (const size of [1, 2, 3, 4]) {
        for (let n = 0; n < 300; n++) {
          const b = new PixelBuffer(64, 64);
          if (id === 'eraser') b.data.fill(255);
          const { ctx } = ctxOf(b, RED, size);
          const t = tool(id);
          let x = Math.floor(rnd() * 64);
          let y = Math.floor(rnd() * 64);
          const pts: [number, number][] = [[x, y]];
          for (let k = 0; k < 6; k++) {
            x = Math.max(-10, Math.min(74, x + Math.floor((rnd() - 0.5) * 40)));
            y = Math.max(-10, Math.min(74, y + Math.floor((rnd() - 0.5) * 40)));
            pts.push([x, y]);
          }
          t.begin(ctx, pts[0][0], pts[0][1]);
          for (const [px, py] of pts.slice(1)) t.move?.(ctx, px, py);
          t.end?.(ctx, pts.at(-1)![0], pts.at(-1)![1]);

          const painted = (px: number, py: number) => {
            const p = b.getPixel(px, py);
            return p !== null && (id === 'eraser' ? p.a === 0 : p.a > 0);
          };
          for (let k = 1; k < pts.length; k++) {
            segments++;
            let broken = false;
            bresenham(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1], (px, py) => {
              if (b.inBounds(px, py) && !painted(px, py)) broken = true;
            });
            if (broken) gaps++;
          }
        }
      }
    }
    expect(segments).toBe(2 * 4 * 300 * 6);
    expect(gaps).toBe(0);
  });
});

describe('Заливка', () => {
  it('заполняет замкнутую область и не выходит за стену', () => {
    const b = new PixelBuffer(8, 8);
    for (let i = 0; i < 8; i++) b.setPixel(i, 3, BLUE);
    tool('fill').begin(ctxOf(b, RED).ctx, 0, 0);
    expect(countWhere(b, (p) => p.r === 255)).toBe(3 * 8);
    expect(countWhere(b, (p) => p.a === 0)).toBe(4 * 8);
  });

  it('4-связность: диагональная линия 1 px не пропускает заливку', () => {
    const c = new PixelBuffer(4, 4);
    for (let i = 0; i < 4; i++) c.setPixel(i, 3 - i, BLUE);
    floodFill(c, 0, 0, RED);
    expect(countWhere(c, (p) => p.r === 255)).toBe(6);
    expect(countWhere(c, (p) => p.a === 0)).toBe(6);
  });

  it('тот же цвет и точка вне холста — без изменений', () => {
    const b = new PixelBuffer(8, 8);
    expect(floodFill(b, -1, 3, RED)).toBe(false);
    floodFill(b, 0, 0, RED);
    expect(floodFill(b, 0, 0, RED)).toBe(false);
  });

  it('BUG-A: прозрачные пиксели со «спрятанным» RGB заливаются как одна область', () => {
    const b = new PixelBuffer(8, 8);
    for (const [x, y] of [[2, 2], [3, 5], [6, 1], [4, 4]]) {
      const i = b.index(x, y);
      b.data[i] = 9;
      b.data[i + 1] = 9;
      b.data[i + 2] = 9; // a остаётся 0
    }
    floodFill(b, 0, 0, RED);
    expect(countWhere(b, (p) => p.r !== 255)).toBe(0);
  });

  it('заливка прозрачным по прозрачной области ничего не меняет, по цветной — стирает', () => {
    const b = new PixelBuffer(6, 6);
    expect(floodFill(b, 0, 0, { r: 7, g: 7, b: 7, a: 0 })).toBe(false);
    floodFill(b, 0, 0, RED);
    expect(floodFill(b, 0, 0, { r: 7, g: 7, b: 7, a: 0 })).toBe(true);
    expect(countWhere(b, (p) => p.a === 0 && p.r === 0)).toBe(36);
  });

  it('помечает грязной ровно залитую область', () => {
    const b = new PixelBuffer(16, 16);
    for (let i = 0; i < 16; i++) b.setPixel(i, 8, BLUE);
    b.takeDirty();
    floodFill(b, 0, 0, RED);
    expect(b.takeDirty()).toEqual({ x: 0, y: 0, width: 16, height: 8 });
  });

  it('большой холст 256×256 заливается быстро и целиком', () => {
    const b = new PixelBuffer(256, 256);
    const t = performance.now();
    expect(floodFill(b, 0, 0, RED)).toBe(true);
    expect(performance.now() - t).toBeLessThan(500);
    expect(countWhere(b, (p) => p.a === 255)).toBe(65536);
  });
});

describe('Пипетка', () => {
  it('берёт цвет, игнорирует прозрачные пиксели и точки вне холста', () => {
    const b = new PixelBuffer(8, 8);
    b.setPixel(2, 2, BLUE);
    const h = ctxOf(b, RED);
    tool('picker').begin(h.ctx, 2, 2);
    expect(h.picked()).toEqual(BLUE);
    tool('picker').begin(h.ctx, 5, 5);
    tool('picker').begin(h.ctx, 99, 99);
    expect(h.picked()).toEqual(BLUE);
  });
});

describe('Линия и прямоугольник', () => {
  it('превью живое, а в итоге остаётся только последняя фигура', () => {
    const b = new PixelBuffer(16, 16);
    b.setPixel(15, 15, BLUE);
    const { ctx } = ctxOf(b);
    const line = tool('line');
    line.begin(ctx, 1, 1);
    line.move?.(ctx, 10, 1);
    expect(countWhere(b, opaque)).toBe(11);
    line.move?.(ctx, 1, 8);
    line.end?.(ctx, 1, 8);
    expect(countWhere(b, opaque)).toBe(9);
    expect(b.getPixel(15, 15)).toEqual(BLUE);
  });

  it('отмена фигуры возвращает исходные пиксели', () => {
    const b = new PixelBuffer(16, 16);
    const { ctx } = ctxOf(b);
    const rect = tool('rect');
    rect.begin(ctx, 2, 2);
    rect.move?.(ctx, 9, 9);
    rect.cancel?.(ctx);
    expect(countWhere(b, opaque)).toBe(0);
  });

  it('контур прямоугольника 6×4 содержит 16 пикселей, углы можно задавать в любом порядке', () => {
    for (const [a, c] of [[[2, 2], [7, 5]], [[7, 5], [2, 2]], [[7, 2], [2, 5]]] as const) {
      const b = new PixelBuffer(16, 16);
      const { ctx } = ctxOf(b);
      tool('rect').begin(ctx, a[0], a[1]);
      tool('rect').end?.(ctx, c[0], c[1]);
      expect(countWhere(b, opaque)).toBe(16);
      expect(b.getPixel(4, 3)?.a).toBe(0);
    }
  });

  it('помечает грязной область прежней и новой фигуры, чтобы стёртое превью исчезло с экрана', () => {
    const b = new PixelBuffer(64, 64);
    const { ctx } = ctxOf(b, RED, 2);
    const line = tool('line');
    line.begin(ctx, 10, 10);
    line.move?.(ctx, 50, 10);
    b.takeDirty();
    line.move?.(ctx, 10, 40); // прежняя горизонтальная линия должна быть стёрта
    const dirty = b.takeDirty();
    expect(dirty).not.toBeNull();
    // каждый пиксель, который изменился относительно «показанного» состояния, лежит в dirty
    const shown = new PixelBuffer(64, 64);
    shown.setPixel(0, 0, BLUE);
    for (let x = 10; x <= 50; x++) {
      stampSquare(shown, x, 10, 2, RED);
    }
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const a = shown.getPixel(x, y) as RGBA;
        const now = b.getPixel(x, y) as RGBA;
        if (x === 0 && y === 0) continue;
        if (a.a !== now.a) {
          expect(x >= dirty!.x && x < dirty!.x + dirty!.width && y >= dirty!.y && y < dirty!.y + dirty!.height).toBe(true);
        }
      }
    }
  });
});
