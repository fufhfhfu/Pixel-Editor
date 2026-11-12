// @vitest-environment jsdom
import { flushSync, tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_KEY } from './core/storage';
import { parseProject, type ProjectData } from './core/project';
import { computeFloodFillOutput, type FloodFillWorkerRequest } from './core/tools/floodFillWorker';
import {
  canvasAlpha,
  canvasData,
  desktopSaveFile,
  drawStroke,
  frame,
  key,
  pointer,
  putCalls,
  rasterDrawCalls,
  remountApp,
  screenOf,
  stage,
  viewport,
} from './test/uiHarness';

describe('Drawing, selection, and history', () => {
  it('первая отрисовка — весь холст; штрих перерисовывает только свою область', async () => {
    await frame();
    expect(putCalls[0].dirty).toEqual([0, 0, 32, 32]);
    putCalls.length = 0;

    drawStroke([4, 4], [9, 4]);
    await frame();
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].dirty).toEqual([4, 4, 6, 1]);
    expect(canvasAlpha(6, 4)).toBe(255);
  });

  it('много событий за кадр сводятся к одной отрисовке', async () => {
    await frame();
    putCalls.length = 0;
    pointer('pointerdown', screenOf(2, 2));
    for (let x = 3; x < 20; x++) pointer('pointermove', screenOf(x, 2 + (x % 3)), { button: -1 });
    pointer('pointerup', screenOf(19, 3));
    await frame();
    expect(putCalls).toHaveLength(1);
  });

  it('Ctrl+Z и Ctrl+Shift+Z: отмена и повтор штриха, кнопки отражают состояние', async () => {
    const undoButton = document.querySelector('[aria-label="Отменить"]') as HTMLButtonElement;
    expect(undoButton.disabled).toBe(true);

    drawStroke([4, 4], [9, 4]);
    await frame();
    expect(undoButton.disabled).toBe(false);
    expect(canvasAlpha(6, 4)).toBe(255);

    key('KeyZ', { ctrlKey: true });
    await frame();
    expect(canvasAlpha(6, 4)).toBe(0);
    expect((document.querySelector('[aria-label="Повторить"]') as HTMLButtonElement).disabled).toBe(false);

    key('KeyZ', { ctrlKey: true, shiftKey: true });
    await frame();
    expect(canvasAlpha(6, 4)).toBe(255);
  });

  it('Shift+левая кнопка рисует дополнительным цветом, если функция включена', async () => {
    drawStroke([4, 4], [4, 4], { shiftKey: true });
    drawStroke([6, 6], [6, 6], { button: 0 });
    await frame();
    const colorAt = (x: number, y: number) => Array.from(canvasData!.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
    expect(colorAt(4, 4)).not.toEqual(colorAt(6, 6));
    expect(colorAt(4, 4)[3]).toBe(255);
  });

  it('настройка во вкладке «Фон» включает и выключает рисование дополнительным цветом', async () => {
    const colorAt = (x: number, y: number) => Array.from(canvasData!.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
    drawStroke([4, 4], [4, 4], { shiftKey: true });
    drawStroke([6, 6], [6, 6]);
    await frame();
    expect(colorAt(4, 4)).not.toEqual(colorAt(6, 6));

    (document.querySelector('button[aria-label="Настройки"]') as HTMLButtonElement).click();
    await tick();
    (document.querySelector('#settings-background-tab') as HTMLButtonElement).click();
    await tick();
    const toggle = document.querySelector(
      'input[aria-label="Рисовать дополнительным цветом через Shift+левую кнопку"]',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    toggle.click();
    await tick();
    expect(localStorage.getItem('pixel-editor:secondary-color-drawing')).toBe('false');
    (document.querySelector('[role="dialog"] button') as HTMLButtonElement).click();
    await tick();

    drawStroke([8, 8], [8, 8], { shiftKey: true });
    await frame();
    expect(colorAt(8, 8)).toEqual(colorAt(6, 6));
  });


});
