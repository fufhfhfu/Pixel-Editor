import { describe, expect, it } from 'vitest';
import { DEFAULT_MIN_STEPS, History, createStep } from './history';
import { PixelBuffer, type RGBA } from './state';
import { TOOLS, type ToolContext, type ToolId } from './tools';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };
const tool = (id: ToolId) => TOOLS.find((t) => t.id === id)!;
const ctxOf = (buffer: PixelBuffer, color = RED, brushSize = 1): ToolContext => ({
  buffer,
  color,
  brushSize,
  invalidate() {},
  setColor() {},
});
const copy = (b: PixelBuffer) => b.data.slice();

/** Штрих целиком: history.begin → инструмент → history.commit — как в приложении. */
function stroke(h: History, b: PixelBuffer, id: ToolId, pts: [number, number][], color = RED, size = 1): boolean {
  const t = tool(id);
  const ctx = ctxOf(b, color, size);
  h.begin(b);
  t.begin(ctx, pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) t.move?.(ctx, x, y);
  const last = pts[pts.length - 1];
  t.end?.(ctx, last[0], last[1]);
  return h.commit(b);
}

describe('undo / redo', () => {
  it('один штрих — один шаг, состояния восстанавливаются точно', () => {
    const b = new PixelBuffer(32, 32);
    const h = new History();
    const s0 = copy(b);
    expect(h.canUndo).toBe(false);
    stroke(h, b, 'pencil', [[2, 2], [20, 9]]);
    const s1 = copy(b);
    stroke(h, b, 'line', [[0, 30], [30, 30]], BLUE, 2);
    const s2 = copy(b);
    expect(h.undoCount).toBe(2);

    expect(h.undo(b)).toBe(b);
    expect(copy(b)).toEqual(s1);
    h.undo(b);
    expect(copy(b)).toEqual(s0);
    expect(h.undo(b)).toBeNull();
    h.redo(b);
    expect(copy(b)).toEqual(s1);
    h.redo(b);
    expect(copy(b)).toEqual(s2);
    expect(h.redo(b)).toBeNull();
  });

  it('новый штрих после отмены обрезает redo', () => {
    const b = new PixelBuffer(32, 32);
    const h = new History();
    stroke(h, b, 'pencil', [[2, 2], [9, 9]]);
    stroke(h, b, 'pencil', [[5, 20], [15, 20]]);
    h.undo(b);
    expect(h.canRedo).toBe(true);
    stroke(h, b, 'rect', [[3, 3], [10, 10]]);
    expect(h.canRedo).toBe(false);
  });

  it('штрихи без изменений не создают шагов', () => {
    const b = new PixelBuffer(16, 16);
    const h = new History();
    expect(stroke(h, b, 'picker', [[1, 1]])).toBe(false);
    expect(stroke(h, b, 'fill', [[0, 0]])).toBe(true);
    expect(stroke(h, b, 'fill', [[5, 5]])).toBe(false);
    expect(stroke(h, b, 'pencil', [[4, 4], [8, 8]])).toBe(false);
    expect(h.undoCount).toBe(1);
  });

  it('хранится только diff: 12 байт на изменённый пиксель + служебные', () => {
    const b = new PixelBuffer(256, 256);
    const h = new History();
    stroke(h, b, 'pencil', [[10, 10], [14, 10]]);
    expect(h.memoryBytes).toBe(5 * 12 + 48);
  });

  it('штрих на холсте 1024×1024 записывает только затронутые пиксели', () => {
    const b = new PixelBuffer(1024, 1024);
    const h = new History();
    h.begin(b);
    b.setPixel(700, 800, RED);
    expect(h.commit(b)).toBe(true);
    expect(h.memoryBytes).toBe(12 + 48);
    expect(h.undo(b)).toBe(b);
    expect(b.getPixel(700, 800)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('все инструменты откатываются и повторяются точно', () => {
    const b = new PixelBuffer(24, 24);
    const h = new History();
    const states = [copy(b)];
    stroke(h, b, 'fill', [[0, 0]], BLUE);
    states.push(copy(b));
    stroke(h, b, 'rect', [[2, 2], [15, 15]], RED, 3);
    states.push(copy(b));
    stroke(h, b, 'eraser', [[5, 5], [5, 20]], RED, 4);
    states.push(copy(b));
    for (let i = states.length - 2; i >= 0; i--) {
      h.undo(b);
      expect(copy(b)).toEqual(states[i]);
    }
    for (let i = 1; i < states.length; i++) {
      h.redo(b);
      expect(copy(b)).toEqual(states[i]);
    }
  });

  it('живое превью фигуры даёт один шаг с итоговой фигурой', () => {
    const b = new PixelBuffer(24, 24);
    const h = new History();
    const s0 = copy(b);
    const t = tool('line');
    const ctx = ctxOf(b);
    h.begin(b);
    t.begin(ctx, 1, 1);
    t.move?.(ctx, 20, 3);
    t.move?.(ctx, 4, 18);
    t.end?.(ctx, 4, 18);
    expect(h.commit(b)).toBe(true);
    expect(h.undoCount).toBe(1);
    h.undo(b);
    expect(copy(b)).toEqual(s0);
  });

  it('нельзя отменять посреди штриха', () => {
    const b = new PixelBuffer(16, 16);
    const h = new History();
    stroke(h, b, 'pencil', [[1, 1], [5, 5]]);
    h.begin(b);
    expect(h.undo(b)).toBeNull();
    expect(h.canUndo).toBe(false);
    h.commit(b);
    expect(h.canUndo).toBe(true);
  });

  it('шаг не применяется к холсту другого размера', () => {
    const b = new PixelBuffer(16, 16);
    const h = new History();
    stroke(h, b, 'pencil', [[1, 1], [5, 5]]);
    expect(h.undo(new PixelBuffer(20, 20))).toBeNull();
    expect(h.undoCount).toBe(1);
  });
});

describe('откат штриха (rollback)', () => {
  it('возвращает буфер к состоянию до штриха и не пишет шаг', () => {
    const b = new PixelBuffer(16, 16);
    const h = new History();
    stroke(h, b, 'pencil', [[1, 1], [5, 1]]);
    const before = copy(b);
    const pen = tool('pencil');
    const ctx = ctxOf(b);
    h.begin(b);
    pen.begin(ctx, 2, 8);
    pen.move?.(ctx, 12, 8);
    expect(h.rollback(b)).toBe(true);
    expect(copy(b)).toEqual(before);
    expect(h.undoCount).toBe(1);
    expect(h.hasPendingStroke).toBe(false);
    b.takeDirty();
  });

  it('после отката перерисовывается весь холст', () => {
    const b = new PixelBuffer(16, 16);
    const h = new History();
    h.begin(b);
    b.setPixel(3, 3, RED);
    b.takeDirty();
    h.rollback(b);
    expect(b.takeDirty()).toEqual({ x: 0, y: 0, width: 16, height: 16 });
  });
});

describe('BUG-B: undo и прозрачность', () => {
  it('ластик по уже прозрачному пикселю со спрятанным RGB не создаёт пустой шаг', () => {
    const b = new PixelBuffer(8, 8);
    const i = b.index(3, 3);
    b.data[i] = 9;
    b.data[i + 1] = 9;
    b.data[i + 2] = 9;
    const h = new History();
    expect(stroke(h, b, 'eraser', [[3, 3]])).toBe(false);
    expect(h.canUndo).toBe(false);
  });

  it('createStep считает два прозрачных пикселя равными', () => {
    const a = new Uint8ClampedArray([9, 9, 9, 0]);
    const b = new Uint8ClampedArray([0, 0, 0, 0]);
    expect(createStep(a, b, 1, 1)).toBeNull();
  });

  it('упаковка сохраняет альфу и старшие байты при отмене', () => {
    const b = new PixelBuffer(4, 4);
    const h = new History();
    h.begin(b);
    b.setPixel(1, 1, { r: 255, g: 255, b: 255, a: 255 });
    b.setPixel(2, 2, { r: 10, g: 20, b: 30, a: 1 });
    h.commit(b);
    h.undo(b);
    expect(b.getPixel(1, 1)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    h.redo(b);
    expect(b.getPixel(1, 1)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    expect(b.getPixel(2, 2)).toEqual({ r: 10, g: 20, b: 30, a: 1 });
  });

  it('отмена и повтор помечают грязными именно изменённые пиксели', () => {
    const b = new PixelBuffer(32, 32);
    const h = new History();
    stroke(h, b, 'pencil', [[5, 6], [9, 6]]);
    b.takeDirty();
    h.undo(b);
    expect(b.takeDirty()).toEqual({ x: 5, y: 6, width: 5, height: 1 });
    h.redo(b);
    expect(b.takeDirty()).toEqual({ x: 5, y: 6, width: 5, height: 1 });
  });
});

describe('BUG-D: смена размера', () => {
  function drawn() {
    const b = new PixelBuffer(32, 32);
    b.setPixel(30, 30, RED);
    b.setPixel(2, 2, BLUE);
    b.setPixel(31, 0, { r: 1, g: 2, b: 3, a: 7 });
    return b;
  }

  it('обрезка отменяется: потерянные пиксели возвращаются', () => {
    const original = drawn();
    const h = new History();
    const small = original.resized(16, 16);
    h.recordResize(original, small);
    expect(small.getPixel(30, 30)).toBeNull();

    const back = h.undo(small);
    expect(back).not.toBeNull();
    expect(back!.width).toBe(32);
    expect(copy(back!)).toEqual(copy(original));
    const again = h.redo(back!);
    expect(again!.width).toBe(16);
    expect(copy(again!)).toEqual(copy(small));
  });

  it('расширение отменяется без потерь, лишние пиксели прозрачные', () => {
    const original = drawn();
    const h = new History();
    const big = original.resized(64, 48);
    h.recordResize(original, big);
    big.setPixel(60, 40, RED);
    // штрих поверх нового размера
    h.begin(big);
    big.setPixel(1, 1, BLUE);
    h.commit(big);
    h.undo(big);
    const back = h.undo(big);
    expect(back!.width).toBe(32);
    expect(copy(back!)).toEqual(copy(original));
  });

  it('шаги до и после смены размера откатываются по очереди', () => {
    const b = new PixelBuffer(32, 32);
    const h = new History();
    stroke(h, b, 'pencil', [[28, 28], [31, 28]]);
    const afterStroke = copy(b);
    const small = b.resized(16, 16);
    h.recordResize(b, small);
    stroke(h, small, 'pencil', [[1, 1], [4, 1]]);

    let current: PixelBuffer = small;
    current = h.undo(current)!; // штрих на малом холсте
    expect(current.width).toBe(16);
    current = h.undo(current)!; // смена размера
    expect(current.width).toBe(32);
    expect(copy(current)).toEqual(afterStroke);
    current = h.undo(current)!; // исходный штрих
    expect(current.data.some((v) => v !== 0)).toBe(false);
  });

  it('прозрачные потери не хранятся: память шага зависит от числа видимых пикселей', () => {
    const b = new PixelBuffer(256, 256);
    b.setPixel(200, 200, RED);
    const h = new History();
    h.recordResize(b, b.resized(16, 16));
    expect(h.memoryBytes).toBe(8 + 48);
  });

  it('шаг не применяется к буферу не того размера', () => {
    const original = drawn();
    const h = new History();
    h.recordResize(original, original.resized(16, 16));
    expect(h.undo(new PixelBuffer(20, 20))).toBeNull();
    expect(h.undoCount).toBe(1);
  });
});

describe('лимиты', () => {
  it('не больше 500 шагов, минимум 100 гарантировано при нехватке памяти', () => {
    const b = new PixelBuffer(64, 64);
    const h = new History();
    for (let i = 0; i < 700; i++) {
      h.begin(b);
      b.setPixel(i % 64, (i >> 6) % 64, { r: i % 256, g: (i >> 8) + 1, b: 7, a: 255 });
      h.commit(b);
    }
    expect(h.undoCount).toBe(500);

    const tight = new History({ maxBytes: 1 });
    const c = new PixelBuffer(16, 16);
    for (let i = 0; i < 250; i++) {
      tight.begin(c);
      c.setPixel(i % 16, (i >> 4) % 16, { r: 1 + (i % 250), g: 2, b: 3, a: 255 });
      tight.commit(c);
    }
    expect(tight.undoCount).toBe(DEFAULT_MIN_STEPS);
  });

  it('после обрезки старых шагов оставшиеся откатываются корректно', () => {
    const h = new History({ maxSteps: 3, minSteps: 1 });
    const c = new PixelBuffer(8, 8);
    for (let i = 0; i < 10; i++) {
      h.begin(c);
      c.setPixel(i % 8, 0, { r: 9, g: i + 1, b: 0, a: 255 });
      h.commit(c);
    }
    expect(h.undoCount).toBe(3);
    let n = 0;
    while (h.undo(c)) n++;
    expect(n).toBe(3);
  });
});
