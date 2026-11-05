/**
 * Ядро: жизненный цикл штриха, общий для мыши, касаний, пера и клавиатуры.
 * Чистый TypeScript, без зависимости от Svelte и DOM.
 *
 * Здесь собрано то, что раньше было размазано по обработчикам указателя: один активный
 * штрих, пропуск повторных позиций, окончание или откат штриха. Благодаря этому логику
 * можно проверять без браузера.
 */

import type { ColorSlot } from './palette';
import type { RGBA } from './state';
import type { Tool, ToolContext } from './tools/types';
import type { PixelPos } from './viewport';

/** Кто ведёт штрих: идентификатор указателя или клавиатура. */
export type StrokeOwner = number | 'keyboard';

/** commit — штрих записывается в историю; rollback — отменяется целиком. */
export type StrokeOutcome = 'commit' | 'rollback';

export interface StrokeHooks {
  makeContext(slot: ColorSlot): ToolContext;
  /** Перед первым изменением пикселей (история запоминает исходное состояние). */
  onBegin(): void;
  /** Штрих начат этим цветом (список недавних). */
  onUseColor(color: RGBA): void;
  /** После tool.end / tool.cancel. */
  onEnd(outcome: StrokeOutcome): void;
}

interface ActiveStroke {
  owner: StrokeOwner;
  tool: Tool;
  slot: ColorSlot;
  x: number;
  y: number;
}

export class StrokeSession {
  private current: ActiveStroke | null = null;

  constructor(private readonly hooks: StrokeHooks) {}

  get isActive(): boolean {
    return this.current !== null;
  }

  isActiveFor(owner: StrokeOwner): boolean {
    return this.current !== null && this.current.owner === owner;
  }

  /** Начинает штрих. Возвращает false, если другой штрих уже идёт. */
  start(owner: StrokeOwner, tool: Tool, slot: ColorSlot, x: number, y: number): boolean {
    if (this.current) return false;
    this.current = { owner, tool, slot, x, y };

    const ctx = this.hooks.makeContext(slot);
    if (tool.usesColor) this.hooks.onUseColor(ctx.color);
    this.hooks.onBegin();
    tool.begin(ctx, x, y);
    return true;
  }

  /** Передаёт инструменту новые позиции; позиции, совпадающие с предыдущей, пропускаются. */
  move(owner: StrokeOwner, points: readonly PixelPos[]): void {
    const stroke = this.current;
    if (!stroke || stroke.owner !== owner) return;

    const ctx = this.hooks.makeContext(stroke.slot);
    for (const p of points) {
      if (p.x === stroke.x && p.y === stroke.y) continue;
      stroke.x = p.x;
      stroke.y = p.y;
      stroke.tool.move?.(ctx, p.x, p.y);
    }
  }

  /** Завершает штрих в точке at (или в последней известной позиции). */
  finish(owner: StrokeOwner, at: PixelPos | null = null): boolean {
    const stroke = this.current;
    if (!stroke || stroke.owner !== owner) return false;
    this.current = null;

    const p = at ?? { x: stroke.x, y: stroke.y };
    stroke.tool.end?.(this.hooks.makeContext(stroke.slot), p.x, p.y);
    this.hooks.onEnd('commit');
    return true;
  }

  /** Отменяет штрих целиком (системная отмена ввода, второй палец, Esc). */
  abort(owner: StrokeOwner): boolean {
    const stroke = this.current;
    if (!stroke || stroke.owner !== owner) return false;
    this.current = null;

    stroke.tool.cancel?.(this.hooks.makeContext(stroke.slot));
    this.hooks.onEnd('rollback');
    return true;
  }

  /** Отменяет штрих независимо от того, кто его ведёт. */
  abortAny(): boolean {
    const stroke = this.current;
    return stroke ? this.abort(stroke.owner) : false;
  }
}
