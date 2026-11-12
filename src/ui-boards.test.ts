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

describe('Canvas board management', () => {
  it('правый клик по выбранному холсту открывает действия удаления и подгонки', async () => {
    (document.querySelector('.add-board') as HTMLButtonElement).click();
    await frame();
    expect(document.querySelectorAll('.board')).toHaveLength(2);

    const unselectedPoint = screenOf(4, 4, 0);
    pointer('pointerdown', unselectedPoint, { button: 2 });
    pointer('pointerup', unselectedPoint, { button: 2 });
    await tick();
    expect(document.querySelector('[aria-label="Действия холста"]')).toBeNull();

    const point = screenOf(4, 4, 1);
    pointer('pointerdown', point, { button: 2 });
    pointer('pointerup', point, { button: 2 });
    await tick();
    const menu = document.querySelector('[role="group"][aria-label="Действия холста"]');
    expect(menu).toBeTruthy();
    expect(Array.from(menu!.querySelectorAll('button')).map((button) => button.textContent?.trim())).toEqual([
      'Удалить',
      'Подогнать холст под изображение',
    ]);

    (menu!.querySelector('button') as HTMLButtonElement).click();
    await frame();
    expect(document.querySelectorAll('.board')).toHaveLength(1);
    expect(document.body.textContent).toContain('Холст удалён');

    (document.querySelector('button[aria-label="Отменить"]') as HTMLButtonElement).click();
    await frame();
    expect(document.querySelectorAll('.board')).toHaveLength(2);
    (document.querySelector('button[aria-label="Повторить"]') as HTMLButtonElement).click();
    await frame();
    expect(document.querySelectorAll('.board')).toHaveLength(1);
  });

  it('подгоняет размер выбранного холста по непрозрачным пикселям и отменяется', async () => {
    drawStroke([4, 5], [4, 5]);
    drawStroke([8, 10], [8, 10]);
    await frame();

    const point = screenOf(12, 12, 0);
    pointer('pointerdown', point, { button: 2 });
    pointer('pointerup', point, { button: 2 });
    await tick();
    const fitButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[aria-label="Действия холста"] button'),
    ).find((button) => button.textContent?.trim() === 'Подогнать холст под изображение');
    expect(fitButton).toBeTruthy();
    fitButton!.click();
    await frame();

    const activeCanvas = document.querySelector('.board.selected canvas') as HTMLCanvasElement;
    expect(activeCanvas.width).toBe(5);
    expect(activeCanvas.height).toBe(6);
    expect(canvasData).toHaveLength(5 * 6 * 4);
    expect(canvasData![3]).toBe(255);
    expect(canvasData![(5 * 5 + 4) * 4 + 3]).toBe(255);

    (document.querySelector('button[aria-label="Отменить"]') as HTMLButtonElement).click();
    await frame();
    expect((document.querySelector('.board.selected canvas') as HTMLCanvasElement).width).toBe(32);
    expect((document.querySelector('.board.selected canvas') as HTMLCanvasElement).height).toBe(32);
    (document.querySelector('button[aria-label="Повторить"]') as HTMLButtonElement).click();
    await frame();
    expect((document.querySelector('.board.selected canvas') as HTMLCanvasElement).width).toBe(5);
    expect((document.querySelector('.board.selected canvas') as HTMLCanvasElement).height).toBe(6);
  });

  it('pointercancel откатывает штрих целиком (случайные следы не остаются)', async () => {
    drawStroke([4, 4], [9, 4]);
    pointer('pointerdown', screenOf(10, 10));
    pointer('pointermove', screenOf(20, 10), { button: -1 });
    await frame();
    expect(canvasAlpha(15, 10)).toBe(255);
    pointer('pointercancel', screenOf(20, 10));
    await frame();
    expect(canvasAlpha(15, 10)).toBe(0);
    expect(canvasAlpha(6, 4)).toBe(255); // прежний штрих цел
  });

  it('BUG-E: потеря захвата без pointerup не «залипает» штрих — следующий штрих рисуется', async () => {
    pointer('pointerdown', screenOf(2, 2));
    pointer('pointermove', screenOf(8, 2), { button: -1 });
    viewport().dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true }));
    flushSync();
    drawStroke([2, 10], [8, 10]);
    await frame();
    expect(canvasAlpha(5, 10)).toBe(255);
    key('KeyZ', { ctrlKey: true });
    await frame();
    expect(canvasAlpha(5, 10)).toBe(0);
    expect(canvasAlpha(5, 2)).toBe(255); // первый штрих завершён и записан в историю
  });

  it('два пальца: штрих первого пальца откатывается, жест не рисует', async () => {
    pointer('pointerdown', screenOf(5, 5), { pointerType: 'touch', pointerId: 11 });
    pointer('pointermove', screenOf(9, 5), { pointerType: 'touch', pointerId: 11, button: -1 });
    await frame();
    expect(canvasAlpha(7, 5)).toBe(255);
    pointer('pointerdown', screenOf(20, 20), { pointerType: 'touch', pointerId: 12 });
    await frame();
    expect(canvasAlpha(7, 5)).toBe(0);
    pointer('pointermove', screenOf(25, 25), { pointerType: 'touch', pointerId: 12, button: -1 });
    pointer('pointerup', screenOf(25, 25), { pointerType: 'touch', pointerId: 12 });
    // оставшийся палец после жеста не рисует
    pointer('pointermove', screenOf(14, 14), { pointerType: 'touch', pointerId: 11, button: -1 });
    pointer('pointerup', screenOf(14, 14), { pointerType: 'touch', pointerId: 11 });
    await frame();
    expect(canvasAlpha(14, 14)).toBe(0);
    expect((document.querySelector('[aria-label="Отменить"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('рисование с клавиатуры: стрелки, Enter начинает и заканчивает штрих, Escape отменяет', async () => {
    viewport().focus();
    viewport().dispatchEvent(new FocusEvent('focus'));
    flushSync();
    const press = (k: string, init: KeyboardEventInit = {}) => {
      viewport().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
      flushSync();
    };
    press('ArrowRight'); // курсор появляется в центре и сдвигается
    const start = document.querySelector('.kcursor');
    expect(start).toBeTruthy();

    press('Enter');
    for (let i = 0; i < 5; i++) press('ArrowRight');
    press('Enter');
    await frame();
    const painted = Array.from({ length: 32 }, (_, x) => canvasAlpha(x, 16)).filter((a) => a === 255).length;
    expect(painted).toBe(6);

    press('Enter');
    press('ArrowDown', { shiftKey: true });
    press('Escape');
    await frame();
    expect(canvasAlpha(21, 16)).toBe(255); // прежний штрих остался
    expect(canvasAlpha(21, 24)).toBe(0); // отменённый — нет
  });

  it('автосохранение: через паузу проект попадает в localStorage и читается обратно', async () => {
    vi.useFakeTimers();
    drawStroke([4, 4], [9, 4]);
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    const saved = parseProject(localStorage.getItem(AUTOSAVE_KEY)!);
    expect(saved.width).toBe(32);
    expect(saved.pixels[(4 * 32 + 6) * 4 + 3]).toBe(255);
    flushSync(); // таймер изменил состояние вне обработчика событий — дожидаемся обновления DOM
    expect(document.body.textContent).toContain('резервное хранилище');
  });

  it('автосохранение восстанавливается при следующем запуске', async () => {
    vi.useFakeTimers();
    drawStroke([4, 4], [9, 4]);
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    await remountApp();
    putCalls.length = 0;
    await frame();
    expect(canvasAlpha(6, 4)).toBe(255);
  });

  it('BUG-D: смена размера — шаг истории; отмена возвращает обрезанное', async () => {
    drawStroke([28, 28], [30, 28]);
    const input = document.querySelector('input[aria-label="Ширина"]') as HTMLInputElement;
    const preset = document.querySelector('#canvas-preset') as HTMLSelectElement;
    preset.value = '16x16';
    preset.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Ctrl+Z');
    expect(input).toBeTruthy();
    ([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.includes('Изменить')) as HTMLButtonElement).click();
    await tick();
    expect(document.body.textContent).toContain('16×16');

    key('KeyZ', { ctrlKey: true });
    await tick();
    await frame();
    expect(document.body.textContent).toContain('32×32');
    expect(canvasAlpha(29, 28)).toBe(255);
  });

  it('очистка холста подтверждается и полностью отменяется через историю', async () => {
    drawStroke([4, 4], [9, 4]);
    await frame();
    (document.querySelector('button[title^="Очистить холст"]') as HTMLButtonElement).click();
    await tick();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Очистить холст?');
    ([...document.querySelectorAll('[role="dialog"] button')].find(
      (button) => button.textContent?.trim() === 'Очистить',
    ) as HTMLButtonElement).click();
    await tick();
    await frame();
    expect(putCalls.at(-1)?.dirty).toEqual([0, 0, 32, 32]);
    expect(canvasAlpha(6, 4)).toBe(0);

    key('KeyZ', { ctrlKey: true });
    await frame();
    expect(putCalls.at(-1)?.dirty).toEqual([4, 4, 6, 1]);
    expect(canvasAlpha(6, 4)).toBe(255);
  });

  it('сохраняет пользовательские размеры отдельно от встроенных и запоминает фон рабочей области', async () => {
    const width = document.querySelector('input[aria-label="Ширина"]') as HTMLInputElement;
    const height = document.querySelector('input[aria-label="Высота"]') as HTMLInputElement;
    width.value = '48';
    width.dispatchEvent(new Event('input', { bubbles: true }));
    height.value = '40';
    height.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Применить')!.click();
    await tick();
    ([...document.querySelectorAll('[role="dialog"] button')].find((button) =>
      button.textContent?.includes('Изменить'),
    ) as HTMLButtonElement).click();
    await tick();
    expect(document.body.textContent).toContain('48×40');

    [...document.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Сохранить размер')!
      .click();
    await tick();
    const sizeSelect = document.querySelector('select[aria-label="Сохранённые размеры холста"]') as HTMLSelectElement;
    expect(Array.from(sizeSelect.options).map((option) => option.value)).toContain('48x40');
    expect(localStorage.getItem('pixel-editor:custom-sizes')).toContain('"width":48');

    (document.querySelector('button[aria-label="Настройки"]') as HTMLButtonElement).click();
    await tick();
    (document.querySelector('#settings-background-tab') as HTMLButtonElement).click();
    await tick();
    expect(document.querySelector('[role="tab"][id="settings-background-tab"]')?.getAttribute('aria-selected')).toBe('true');

    const background = document.querySelector('input[aria-label="Фон рабочего пространства"]') as HTMLInputElement;
    background.value = '#112233';
    background.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(viewport().style.backgroundColor).toBe('rgb(17, 34, 51)');
    expect(localStorage.getItem('pixel-editor:workspace-background')).toBe('#112233');

    const canvasBackground = document.querySelector('input[aria-label="Фон холста"]') as HTMLInputElement;
    canvasBackground.value = '#aabbcc';
    canvasBackground.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect((document.querySelector('.board') as HTMLElement).style.backgroundColor).toBe('rgb(170, 187, 204)');
    expect(localStorage.getItem('pixel-editor:canvas-background')).toBe('#aabbcc');
  });

  it('uses a white default canvas while keeping the surrounding workspace dark', async () => {
    expect((document.querySelector('.board') as HTMLElement).style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(viewport().style.backgroundColor).toBe('rgb(52, 54, 63)');
  });

  it('pans the unbounded workspace by right-button dragging without a horizontal scrollbar', async () => {
    expect(document.querySelector('[aria-label="Горизонтальная прокрутка холста"]')).toBeNull();
    key('Equal');
    key('Equal');
    key('Equal');
    await tick();
    await frame();
    const before = stage().style.transform;
    const start = screenOf(8, 8);
    const end = { x: start.x + 2400, y: start.y - 1800 };
    pointer('pointerdown', start, { button: 2 });
    pointer('pointermove', end, { button: -1 });
    pointer('pointerup', end, { button: 2 });
    await tick();
    expect(stage().style.transform).not.toBe(before);
    const offsets = (value: string) => value.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)!.slice(1).map(Number);
    const [beforeX, beforeY] = offsets(before);
    const [afterX, afterY] = offsets(stage().style.transform);
    expect(afterX! - beforeX!).toBe(2400);
    expect(afterY! - beforeY!).toBe(-1800);
    expect(document.querySelector('[aria-label="Действия холста"]')).toBeNull();
    expect(document.querySelector('[aria-label="Горизонтальная прокрутка холста"]')).toBeNull();
  });

  it('exposes thickness controls for pencil and eraser and applies size changes', async () => {
    const pencilControl = document.querySelector('summary[aria-label="Настроить толщину: Карандаш"]') as HTMLElement;
    expect(pencilControl).toBeTruthy();
    pencilControl.click();
    await tick();
    expect(pencilControl.parentElement?.matches('details[open]')).toBe(true);

    const pencilSize = document.querySelector('input[aria-label="Толщина: Карандаш"]') as HTMLInputElement;
    expect(pencilSize.value).toBe('1');
    pencilSize.value = '7';
    pencilSize.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(pencilControl.textContent?.trim()).toBe('7 px');

    (document.querySelector('button[aria-label="Ластик (E)"]') as HTMLButtonElement).click();
    await tick();
    const eraserControl = document.querySelector('summary[aria-label="Настроить толщину: Ластик"]') as HTMLElement;
    expect(eraserControl).toBeTruthy();
    expect(eraserControl.textContent?.trim()).toBe('1 px');
    eraserControl.click();
    await tick();
    expect(eraserControl.parentElement?.matches('details[open]')).toBe(true);
    const eraserSize = document.querySelector('input[aria-label="Толщина: Ластик"]') as HTMLInputElement;
    expect(eraserSize.value).toBe('1');
    eraserSize.value = '11';
    eraserSize.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(eraserControl.textContent?.trim()).toBe('11 px');

    (document.querySelector('button[aria-label="Карандаш (P)"]') as HTMLButtonElement).click();
    await tick();
    expect((document.querySelector('input[aria-label="Толщина: Карандаш"]') as HTMLInputElement).value).toBe('7');
    expect((document.querySelector('input[aria-label="Толщина: Ластик"]') as HTMLInputElement).value).toBe('11');
  });

  it('adds multiple boards and selects/moves them with Ctrl+right-drag', async () => {
    drawStroke([4, 4], [4, 4]);
    const undoButton = document.querySelector('[aria-label="Отменить"]') as HTMLButtonElement;
    expect(undoButton.disabled).toBe(false);

    (document.querySelector('.add-board') as HTMLButtonElement).click();
    await tick();
    await frame();
    expect(document.querySelectorAll('.board')).toHaveLength(2);
    expect(document.querySelectorAll('.board.selected')).toHaveLength(1);
    expect(undoButton.disabled).toBe(false);
    key('KeyZ', { ctrlKey: true });
    await tick();
    expect(document.querySelectorAll('.board')).toHaveLength(1);
    expect((document.querySelector('[aria-label="Повторить"]') as HTMLButtonElement).disabled).toBe(false);
    key('KeyY', { ctrlKey: true });
    await tick();
    await frame();
    const boards = [...document.querySelectorAll<HTMLElement>('.board')];
    expect(boards).toHaveLength(2);

    const secondBoardPoint = screenOf(5, 5, 1);
    const zoom = parseFloat(boards[1].style.width) / 32;
    expect(boards[1].style.left).toBe(`${64 * zoom}px`);
    const originalPositions = boards.map((board) => ({ left: board.style.left, top: board.style.top }));
    const start = secondBoardPoint;
    pointer('pointerdown', start, { button: 2, ctrlKey: true });
    const singleMove = { x: start.x + zoom * 5, y: start.y + zoom * 3 };
    pointer('pointermove', singleMove, { button: -1, ctrlKey: true });
    pointer('pointerup', singleMove, { button: 2, ctrlKey: true });
    await tick();
    expect(boards[0]!.style.left).toBe(originalPositions[0]!.left);
    expect(boards[0]!.style.top).toBe(originalPositions[0]!.top);
    expect(boards[1]!.style.left).toBe(`${69 * zoom}px`);
    expect(boards[1]!.style.top).toBe(`${3 * zoom}px`);

    key('KeyZ', { ctrlKey: true });
    await tick();
    expect(boards[1]!.style.left).toBe(originalPositions[1]!.left);
    expect(boards[1]!.style.top).toBe(originalPositions[1]!.top);

    const firstBoardPoint = screenOf(5, 5, 0);
    pointer('pointerdown', firstBoardPoint, { button: 2, ctrlKey: true });
    pointer('pointerup', firstBoardPoint, { button: 2, ctrlKey: true });
    await tick();
    expect(document.querySelectorAll('.board.group-selected')).toHaveLength(1);

    const groupStart = screenOf(5, 5, 1);
    pointer('pointerdown', groupStart, { button: 2, ctrlKey: true });
    const moved = { x: groupStart.x + zoom * 5, y: groupStart.y + zoom * 3 };
    pointer('pointermove', moved, { button: -1, ctrlKey: true });
    expect(boards[1]!.style.left).toBe(originalPositions[1]!.left);
    expect(boards[1]!.style.top).toBe(originalPositions[1]!.top);
    expect(document.querySelectorAll('.drop-preview')).toHaveLength(2);
    expect(document.querySelector('.drop-preview')).toBeTruthy();
    pointer('pointerup', moved, { button: 2, ctrlKey: true });
    await tick();

    const movedBoard = document.querySelectorAll<HTMLElement>('.board')[1];
    expect(movedBoard.classList.contains('selected')).toBe(true);
    expect(movedBoard.style.left).toBe(`${69 * zoom}px`);
    expect(movedBoard.style.top).toBe(`${3 * zoom}px`);
    expect(boards[0]!.style.left).toBe(`${5 * zoom}px`);
    expect(boards[0]!.style.top).toBe(`${3 * zoom}px`);
    pointer('pointerdown', { x: 790, y: 590 }, { button: 0 });
    pointer('pointerup', { x: 790, y: 590 }, { button: 0 });
    await tick();
    expect(document.querySelectorAll('.board.group-selected')).toHaveLength(0);

    key('KeyZ', { ctrlKey: true });
    await tick();
    expect(boards[0]!.style.left).toBe(originalPositions[0]!.left);
    expect(boards[0]!.style.top).toBe(originalPositions[0]!.top);
    expect(boards[1]!.style.left).toBe(originalPositions[1]!.left);
    expect(boards[1]!.style.top).toBe(originalPositions[1]!.top);
    key('KeyY', { ctrlKey: true });
    await tick();
    expect(document.querySelectorAll<HTMLElement>('.board')[1].style.left).toBe(`${69 * zoom}px`);

  });

  it('places new canvases with a visible gap from every existing canvas', async () => {
    for (let index = 0; index < 4; index++) {
      (document.querySelector('.add-board') as HTMLButtonElement).click();
      await frame();
    }

    const boards = [...document.querySelectorAll<HTMLElement>('.board')];
    expect(boards).toHaveLength(5);
    const zoom = parseFloat(boards[0]!.style.width) / 32;
    const positions = boards.map((board) => ({
      x: parseFloat(board.style.left) / zoom,
      y: parseFloat(board.style.top) / zoom,
    }));

    for (let first = 0; first < positions.length; first++) {
      for (let second = first + 1; second < positions.length; second++) {
        const a = positions[first]!;
        const b = positions[second]!;
        const gapX = Math.max(0, a.x - (b.x + 32), b.x - (a.x + 32));
        const gapY = Math.max(0, a.y - (b.y + 32), b.y - (a.y + 32));
        expect(gapX >= 32 || gapY >= 32).toBe(true);
      }
    }
  });

  it('swaps board positions when a dropped board covers at least half the other board', async () => {
    (document.querySelector('.add-board') as HTMLButtonElement).click();
    await tick();
    await frame();
    const boards = [...document.querySelectorAll<HTMLElement>('.board')];
    const zoom = parseFloat(boards[1].style.width) / 32;
    const originalLeft = boards.map((board) => board.style.left);
    const start = screenOf(5, 5, 1);
    const target = { x: start.x - zoom * 48, y: start.y };

    pointer('pointerdown', start, { button: 2, ctrlKey: true });
    pointer('pointermove', target, { button: -1, ctrlKey: true });
    expect(document.querySelectorAll<HTMLElement>('.board')[1].style.left).toBe(originalLeft[1]);
    expect(document.querySelector('.drop-preview')).toBeTruthy();
    pointer('pointerup', target, { button: 2, ctrlKey: true });
    await tick();

    const swapped = [...document.querySelectorAll<HTMLElement>('.board')];
    expect(swapped[0].style.left).toBe(originalLeft[1]);
    expect(swapped[1].style.left).toBe(originalLeft[0]);
    key('KeyZ', { ctrlKey: true });
    await tick();
    expect([...document.querySelectorAll<HTMLElement>('.board')].map((board) => board.style.left)).toEqual(originalLeft);
    key('KeyY', { ctrlKey: true });
    await tick();
    expect([...document.querySelectorAll<HTMLElement>('.board')].map((board) => board.style.left)).toEqual([
      originalLeft[1],
      originalLeft[0],
    ]);
  });

  it('requires selecting an unselected board before it can be moved', async () => {
    (document.querySelector('.add-board') as HTMLButtonElement).click();
    await tick();
    await frame();

    const boards = [...document.querySelectorAll<HTMLElement>('.board')];
    const first = boards[0]!;
    const originalPosition = { left: first.style.left, top: first.style.top };
    const secondPosition = { left: boards[1]!.style.left, top: boards[1]!.style.top };
    const zoom = parseFloat(first.style.width) / 32;
    const start = screenOf(5, 5, 0);
    const target = { x: start.x + zoom * 5, y: start.y + zoom * 3 };

    pointer('pointerdown', start, { button: 2, ctrlKey: true });
    pointer('pointermove', target, { button: -1, ctrlKey: true });
    pointer('pointerup', target, { button: 2, ctrlKey: true });
    await tick();

    expect(first.style.left).toBe(originalPosition.left);
    expect(first.style.top).toBe(originalPosition.top);
    expect(first.classList.contains('selected')).toBe(true);
    expect(document.querySelector('[aria-label="Действия холста"]')).toBeNull();

    const selectedStart = screenOf(5, 5, 0);
    const selectedTarget = { x: selectedStart.x + zoom * 5, y: selectedStart.y + zoom * 3 };
    pointer('pointerdown', selectedStart, { button: 2, ctrlKey: true });
    pointer('pointermove', selectedTarget, { button: -1, ctrlKey: true });
    pointer('pointerup', selectedTarget, { button: 2, ctrlKey: true });
    await tick();

    expect(first.style.left).toBe(`${5 * zoom}px`);
    expect(first.style.top).toBe(`${3 * zoom}px`);
    expect(boards[1]!.style.left).toBe(secondPosition.left);
    expect(boards[1]!.style.top).toBe(secondPosition.top);
  });

  it('snaps a dragged board to neighboring edges and shows blue corner alignment guides', async () => {
    (document.querySelector('.add-board') as HTMLButtonElement).click();
    await tick();
    await frame();
    const boards = [...document.querySelectorAll<HTMLElement>('.board')];
    const zoom = parseFloat(boards[1].style.width) / 32;
    const start = screenOf(5, 5, 1);
    const nearAlignedEdge = { x: start.x - 33 * zoom, y: start.y };

    pointer('pointerdown', start, { button: 2, ctrlKey: true });
    pointer('pointermove', nearAlignedEdge, { button: -1, ctrlKey: true });
    expect(document.querySelector('.drop-preview')).toBeTruthy();
    expect(document.querySelectorAll('.alignment-guide').length).toBeGreaterThan(0);
    pointer('pointerup', nearAlignedEdge, { button: 2, ctrlKey: true });
    await tick();

    const movedBoard = document.querySelectorAll<HTMLElement>('.board')[1];
    expect(movedBoard.style.left).toBe(`${32 * zoom}px`);
    expect(movedBoard.style.top).toBe('0px');
  });

  it('keeps canvas zoom unchanged as new boards are added nearby', async () => {
    const initialBoard = document.querySelector('.board') as HTMLElement;
    const initialZoom = parseFloat(initialBoard.style.width) / (initialBoard.querySelector('canvas') as HTMLCanvasElement).width;

    for (let i = 0; i < 6; i++) {
      (document.querySelector('.add-board') as HTMLButtonElement).click();
      await tick();
      await frame();
    }

    const boards = [...document.querySelectorAll<HTMLElement>('.board')];
    const zooms = boards.map((board) =>
      parseFloat(board.style.width) / (board.querySelector('canvas') as HTMLCanvasElement).width,
    );
    expect(zooms.every((zoom) => Math.abs(zoom - initialZoom) < 0.0001)).toBe(true);
    expect(Math.max(...boards.map((board) => Math.abs(parseFloat(board.style.left))))).toBeLessThan(400 * initialZoom);
  });


});
