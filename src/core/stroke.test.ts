import { describe, expect, it } from 'vitest';
import type { ColorSlot } from './palette';
import { PixelBuffer, type RGBA } from './state';
import { StrokeSession, type StrokeOutcome } from './stroke';
import { TOOLS, type ToolContext, type ToolId } from './tools';

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const GREEN: RGBA = { r: 0, g: 255, b: 0, a: 255 };

const tool = (id: ToolId) => TOOLS.find((t) => t.id === id)!;

function setup() {
  const buffer = new PixelBuffer(16, 16);
  const log: string[] = [];
  const picked: Array<[ColorSlot, RGBA]> = [];
  const session = new StrokeSession({
    makeContext: (slot): ToolContext => ({
      buffer,
      color: slot === 'primary' ? RED : GREEN,
      brushSize: 1,
      invalidate: () => {},
      setColor: (c) => picked.push([slot, c]),
    }),
    onBegin: () => log.push('begin'),
    onUseColor: (c) => log.push(`color:${c.r},${c.g},${c.b}`),
    onEnd: (o: StrokeOutcome) => log.push(`end:${o}`),
  });
  return { buffer, session, log, picked };
}

describe('StrokeSession', () => {
  it('порядок: цвет → начало истории → инструмент → конец', () => {
    const { session, log, buffer } = setup();
    expect(session.start(1, tool('pencil'), 'primary', 2, 2)).toBe(true);
    session.move(1, [{ x: 6, y: 2 }]);
    session.finish(1, { x: 6, y: 2 });
    expect(log).toEqual(['color:255,0,0', 'begin', 'end:commit']);
    expect(buffer.getPixel(4, 2)?.a).toBe(255);
    expect(session.isActive).toBe(false);
  });

  it('правая кнопка рисует дополнительным цветом', () => {
    const { session, buffer } = setup();
    session.start(1, tool('pencil'), 'secondary', 3, 3);
    session.finish(1);
    expect(buffer.getPixel(3, 3)).toEqual(GREEN);
  });

  it('инструменты без цвета (ластик, пипетка) не попадают в недавние', () => {
    const { session, log } = setup();
    session.start(1, tool('eraser'), 'primary', 1, 1);
    session.finish(1);
    session.start(2, tool('picker'), 'primary', 1, 1);
    session.finish(2);
    expect(log.some((l) => l.startsWith('color:'))).toBe(false);
  });

  it('второй штрих не начинается, пока идёт первый; чужой владелец ничего не меняет', () => {
    const { session, log } = setup();
    expect(session.start(1, tool('pencil'), 'primary', 0, 0)).toBe(true);
    expect(session.start(2, tool('pencil'), 'primary', 5, 5)).toBe(false);
    session.move(2, [{ x: 9, y: 9 }]);
    expect(session.finish(2)).toBe(false);
    expect(session.abort(2)).toBe(false);
    expect(session.isActiveFor(1)).toBe(true);
    expect(log.filter((l) => l === 'begin').length).toBe(1);
  });

  it('повторные позиции пропускаются, пропущенные клетки закрывает инструмент', () => {
    const { session, buffer } = setup();
    session.start('keyboard', tool('pencil'), 'primary', 0, 0);
    session.move('keyboard', [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 0 }]);
    session.finish('keyboard');
    for (let x = 0; x <= 8; x++) expect(buffer.getPixel(x, 0)?.a).toBe(255);
  });

  it('abort отдаёт результат rollback и отменяет фигуру', () => {
    const { session, log, buffer } = setup();
    session.start(1, tool('rect'), 'primary', 2, 2);
    session.move(1, [{ x: 9, y: 9 }]);
    expect(session.abort(1)).toBe(true);
    expect(log.at(-1)).toBe('end:rollback');
    expect(buffer.data.some((v) => v !== 0)).toBe(false);
  });

  it('заливка и пипетка срабатывают на начале штриха; пипетка пишет в слот штриха', () => {
    const { session, buffer, picked } = setup();
    buffer.setPixel(4, 4, GREEN);
    session.start(1, tool('picker'), 'secondary', 4, 4);
    session.finish(1);
    expect(picked[0][0]).toBe('secondary');
    session.start(2, tool('fill'), 'primary', 0, 0);
    session.finish(2);
    expect(buffer.getPixel(0, 0)).toEqual(RED);
  });

  it('abortAny снимает штрих, кто бы его ни вёл', () => {
    const { session } = setup();
    session.start(7, tool('pencil'), 'primary', 1, 1);
    expect(session.abortAny()).toBe(true);
    expect(session.abortAny()).toBe(false);
    expect(session.start(8, tool('pencil'), 'primary', 1, 1)).toBe(true);
  });
});
