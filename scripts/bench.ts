/**
 * Замер CPU-части конвейера рисования без браузера: обработка событий указателя,
 * инструменты, грязные области, история. Запуск: npm run bench
 *
 * Не измеряет то, что делает браузер (композитинг, putImageData на GPU): для этого
 * откройте DevTools → Performance и порисуйте на сетке 64×64.
 */
import { History } from '../src/core/history';
import { PixelBuffer } from '../src/core/state';
import { StrokeSession } from '../src/core/stroke';
import { TOOLS, type ToolId } from '../src/core/tools';
import { floodFill } from '../src/core/tools/floodFill';

const FRAME_BUDGET_MS = 1000 / 60;
const EVENTS_PER_FRAME = 8; // быстрое движение мыши с getCoalescedEvents

function measure(label: string, iterations: number, run: (i: number) => void): number {
  for (let i = 0; i < Math.min(200, iterations); i++) run(i); // прогрев
  const start = performance.now();
  for (let i = 0; i < iterations; i++) run(i);
  const perOp = (performance.now() - start) / iterations;
  console.log(`${label.padEnd(58)} ${(perOp * 1000).toFixed(1).padStart(9)} мкс`);
  return perOp;
}

function strokeBench(size: number, toolId: ToolId, brush: number): number {
  const buffer = new PixelBuffer(size, size);
  const tool = TOOLS.find((t) => t.id === toolId)!;
  const color = { r: 255, g: 0, b: 77, a: 255 };
  const iterations = size >= 256
    ? (toolId === 'line' || toolId === 'rect' ? 250 : 1_000)
    : toolId === 'line' || toolId === 'rect'
      ? 2_000
      : 5_000;
  const session = new StrokeSession({
    makeContext: () => ({ buffer, color, brushSize: brush, invalidate() {}, setColor() {} }),
    onBegin() {},
    onUseColor() {},
    onEnd() {},
  });
  session.start(1, tool, 'primary', 0, 0);
  let t = 0;
  const perFrame = measure(`${size}×${size} ${toolId}, кисть ${brush}: кадр из ${EVENTS_PER_FRAME} событий + takeDirty`, iterations, () => {
    const points = [];
    for (let k = 0; k < EVENTS_PER_FRAME; k++) {
      t += 0.35;
      points.push({ x: Math.floor((Math.sin(t) * 0.5 + 0.5) * (size - 1)), y: Math.floor((Math.cos(t * 0.7) * 0.5 + 0.5) * (size - 1)) });
    }
    session.move(1, points);
    buffer.takeDirty();
  });
  session.finish(1);
  return perFrame;
}

console.log('— Обработка движения (CPU на один кадр) —');
const frames = [
  strokeBench(64, 'pencil', 1),
  strokeBench(64, 'pencil', 4),
  strokeBench(64, 'eraser', 4),
  strokeBench(64, 'line', 4),
  strokeBench(64, 'rect', 4),
  strokeBench(256, 'pencil', 4),
  strokeBench(256, 'rect', 4),
];
console.log(`Бюджет кадра при 60 fps: ${FRAME_BUDGET_MS.toFixed(2)} мс; худший замер: ${(Math.max(...frames) * 1000).toFixed(1)} мкс (${((Math.max(...frames) / FRAME_BUDGET_MS) * 100).toFixed(2)}% бюджета)\n`);

console.log('— Разовые операции —');
for (const size of [64, 256, 1024]) {
  const buffer = new PixelBuffer(size, size);
  const history = new History();
  measure(`${size}×${size} начало штриха (sparse capture) + diff 200 пикселей`, 2_000, (i) => {
    history.begin(buffer);
    for (let k = 0; k < 200; k++) buffer.setPixel((k * 7 + i) % size, (k * 3) % size, { r: 1 + (i % 250), g: 2, b: 3, a: 255 });
    history.commit(buffer);
  });

  if (size <= 256) {
    // Заливка всего холста одного цвета другим цветом: худший случай, каждый раз меняются все пиксели
    const blank = new PixelBuffer(size, size);
    measure(`${size}×${size} заливка всего холста (все пиксели меняются)`, 300, (i) => {
      floodFill(blank, 0, 0, { r: 1 + (i % 250), g: 1, b: 9, a: 255 });
    });

    const undoable = new PixelBuffer(size, size);
    const fillHistory = new History();
    measure(`${size}×${size} заливка всего холста как шаг истории + undo`, 100, (i) => {
      fillHistory.begin(undoable);
      floodFill(undoable, 0, 0, { r: 1 + (i % 250), g: 1, b: 9, a: 255 });
      fillHistory.commit(undoable);
      fillHistory.undo(undoable);
    });
  }
}
