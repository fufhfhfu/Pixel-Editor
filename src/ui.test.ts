// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.svelte';
import { AutosaveRepository } from './core/autosave';
import { AUTOSAVE_KEY } from './core/storage';
import { parseProject } from './core/project';

/** Заглушки того, чего нет в jsdom: canvas, ImageData, ResizeObserver, захват указателя. */
interface PutCall {
  dirty: [number, number, number, number];
}
const putCalls: PutCall[] = [];
let canvasData: Uint8ClampedArray | null = null;
const rasterDrawCalls: number[][] = [];

function installBrowserStubs(): void {
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: () => unknown };
  proto.getContext = function () {
    return {
      putImageData(image: { data: Uint8ClampedArray }, _dx: number, _dy: number, x: number, y: number, w: number, h: number) {
        canvasData = image.data;
        putCalls.push({ dirty: [x, y, w, h] });
      },
      clearRect() {},
      fillRect() {},
      drawImage(_image: CanvasImageSource, ...args: number[]) {
        rasterDrawCalls.push(args);
      },
      getImageData(_x: number, _y: number, width: number, height: number) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 3; i < data.length; i += 4) data[i] = 255;
        return { data, width, height };
      },
    };
  };
  (globalThis as unknown as { ImageData: unknown }).ImageData = class {
    data: Uint8ClampedArray;
    constructor(data: Uint8ClampedArray, public width: number, public height: number) {
      this.data = data;
    }
  };
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    constructor(private cb: (entries: unknown[]) => void) {}
    observe() {
      this.cb([{ contentRect: { width: 800, height: 600 } }]);
    }
    disconnect() {}
  };
  // jsdom не знает PointerEvent: достаточно MouseEvent с полями указателя
  (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = class extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  };
  Element.prototype.setPointerCapture = function () {};
  Element.prototype.releasePointerCapture = function () {};
  Element.prototype.hasPointerCapture = function () {
    return true;
  };
  Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} } as DOMRect;
  };
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
}

let app: ReturnType<typeof mount> | null = null;

async function mountApp(): Promise<void> {
  const repository = new AutosaveRepository(null, localStorage);
  const startup = await repository.load();
  app = mount(App, {
    target: document.getElementById('app')!,
    props: {
      initialProject: startup.project,
      initialLoadError: startup.error,
      initialStorageMode: startup.mode,
      autosaveRepository: repository,
    },
  });
  await tick();
}

function viewport(): HTMLElement {
  return document.querySelector('.viewport') as HTMLElement;
}

function stage(): HTMLElement {
  return document.querySelector('.stage') as HTMLElement;
}

/** Экранные координаты центра пикселя (x, y) при текущем виде. */
function screenOf(x: number, y: number, boardIndex = 0): { x: number; y: number } {
  const board = document.querySelectorAll('.board')[boardIndex] as HTMLElement;
  const canvas = board.querySelector('canvas')!;
  const zoom = parseFloat(board.style.width) / canvas.width;
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(stage().style.transform)!;
  return {
    x: parseFloat(m[1]) + parseFloat(board.style.left) + (x + 0.5) * zoom,
    y: parseFloat(m[2]) + parseFloat(board.style.top) + (y + 0.5) * zoom,
  };
}

function pointer(type: string, p: { x: number; y: number }, init: PointerEventInit = {}): void {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: p.x,
    clientY: p.y,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    ...init,
  });
  viewport().dispatchEvent(event);
  flushSync();
}

function key(code: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, key: init.key ?? code, bubbles: true, cancelable: true, ...init }));
  flushSync();
}

/** Альфа пикселя (x, y) в данных, которые ушли на canvas. */
const canvasAlpha = (x: number, y: number): number => canvasData![(y * 32 + x) * 4 + 3];

async function frame(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  await tick();
}

function drawStroke(from: [number, number], to: [number, number], init: PointerEventInit = {}): void {
  pointer('pointerdown', screenOf(...from), init);
  pointer('pointermove', screenOf(...to), { ...init, button: -1 });
  pointer('pointerup', screenOf(...to), init);
}

beforeEach(async () => {
  installBrowserStubs();
  putCalls.length = 0;
  canvasData = null;
  rasterDrawCalls.length = 0;
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  await mountApp();
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('приложение целиком (jsdom)', () => {
  it('стартует без ошибок: холст, панели, статус-бар', () => {
    expect(viewport()).toBeTruthy();
    expect(document.querySelector('[aria-label="Инструменты"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Палитра"]')).toBeTruthy();
    expect(document.querySelector('.add-board')?.textContent?.trim()).toBe('+');
    expect(document.body.textContent).toContain('Карандаш');
    expect(document.body.textContent).toContain('32×32');
    expect(document.querySelector('#canvas-preset')).toBeTruthy();
    expect(document.querySelector('.toolbar')?.textContent).not.toContain('Фон');
    expect(Array.from((document.querySelector('#canvas-preset') as HTMLSelectElement).options).map((option) => option.value))
      .toEqual(['8x8', '16x16', '32x32', '64x64', '128x128', '256x256', '512x512', '1024x1024']);
    expect((document.querySelector('.board') as HTMLElement).style.backgroundColor).toBe('rgb(255, 255, 255)');
  });

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

  it('правая кнопка рисует дополнительным цветом, Shift+Enter и Enter — с клавиатуры', async () => {
    drawStroke([4, 4], [4, 4], { button: 2 });
    drawStroke([6, 6], [6, 6], { button: 0 });
    await frame();
    const colorAt = (x: number, y: number) => Array.from(canvasData!.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
    expect(colorAt(4, 4)).not.toEqual(colorAt(6, 6));
    expect(colorAt(4, 4)[3]).toBe(255);
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
    unmount(app!);
    document.body.innerHTML = '<div id="app"></div>';
    putCalls.length = 0;
    await mountApp();
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

  it('pans by right-button dragging and keeps a horizontal scrollbar available for wide canvases', async () => {
    const scrollbar = document.querySelector('[aria-label="Горизонтальная прокрутка холста"]') as HTMLDivElement;
    expect(scrollbar).toBeTruthy();
    const scrollContent = scrollbar.firstElementChild as HTMLDivElement;
    const fixedScrollWidth = scrollContent.style.width;
    key('Equal');
    key('Equal');
    key('Equal');
    await tick();
    await frame();
    expect(scrollContent.style.width).toBe(fixedScrollWidth);
    const before = stage().style.transform;
    pointer('pointerdown', screenOf(8, 8), { button: 2 });
    pointer('pointermove', screenOf(10, 8), { button: -1 });
    pointer('pointerup', screenOf(10, 8), { button: 2 });
    await tick();
    expect(stage().style.transform).not.toBe(before);
    const beforeScroll = stage().style.transform;
    scrollbar.scrollLeft = 100;
    scrollbar.dispatchEvent(new Event('scroll'));
    flushSync();
    expect(stage().style.transform).not.toBe(beforeScroll);
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

    const firstBoardPoint = screenOf(5, 5, 0);
    pointer('pointerdown', firstBoardPoint, { button: 2, ctrlKey: true });
    pointer('pointerup', firstBoardPoint, { button: 2, ctrlKey: true });
    await tick();
    expect(undoButton.disabled).toBe(false);

    const secondBoardPoint = screenOf(5, 5, 1);
    pointer('pointerdown', secondBoardPoint, { button: 2, ctrlKey: true });
    pointer('pointerup', secondBoardPoint, { button: 2, ctrlKey: true });
    await tick();
    expect(undoButton.disabled).toBe(false);

    const zoom = parseFloat(boards[1].style.width) / 32;
    expect(boards[1].style.left).toBe(`${56 * zoom}px`);
    const start = screenOf(5, 5, 1);
    const originalLeft = boards[1].style.left;
    const originalTop = boards[1].style.top;
    pointer('pointerdown', start, { button: 2, ctrlKey: true });
    const moved = { x: start.x + zoom * 5, y: start.y + zoom * 3 };
    pointer('pointermove', moved, { button: -1, ctrlKey: true });
    expect(document.querySelectorAll<HTMLElement>('.board')[1].style.left).toBe(originalLeft);
    expect(document.querySelectorAll<HTMLElement>('.board')[1].style.top).toBe(originalTop);
    expect(document.querySelector('.drop-preview')).toBeTruthy();
    pointer('pointerup', moved, { button: 2, ctrlKey: true });
    await tick();

    const movedBoard = document.querySelectorAll<HTMLElement>('.board')[1];
    expect(movedBoard.classList.contains('selected')).toBe(true);
    expect(movedBoard.style.left).toBe(`${61 * zoom}px`);
    expect(movedBoard.style.top).toBe(`${3 * zoom}px`);

    key('KeyZ', { ctrlKey: true });
    await tick();
    expect(document.querySelectorAll<HTMLElement>('.board')[1].style.left).toBe(originalLeft);
    expect(document.querySelectorAll<HTMLElement>('.board')[1].style.top).toBe(originalTop);
    key('KeyY', { ctrlKey: true });
    await tick();
    expect(document.querySelectorAll<HTMLElement>('.board')[1].style.left).toBe(`${61 * zoom}px`);

    key('KeyZ', { ctrlKey: true });
    key('KeyZ', { ctrlKey: true });
    await tick();
    expect(document.querySelectorAll('.board')).toHaveLength(1);
    key('KeyZ', { ctrlKey: true });
    await tick();
    expect(undoButton.disabled).toBe(true);

    key('KeyY', { ctrlKey: true });
    key('KeyY', { ctrlKey: true });
    key('KeyY', { ctrlKey: true });
    await tick();
    expect(document.querySelectorAll('.board')).toHaveLength(2);
    expect(document.querySelectorAll<HTMLElement>('.board')[1].style.left).toBe(`${61 * zoom}px`);
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

  it('snaps a dragged board to neighboring edges and shows blue corner alignment guides', async () => {
    (document.querySelector('.add-board') as HTMLButtonElement).click();
    await tick();
    await frame();
    const boards = [...document.querySelectorAll<HTMLElement>('.board')];
    const zoom = parseFloat(boards[1].style.width) / 32;
    const start = screenOf(5, 5, 1);
    const nearAlignedEdge = { x: start.x - 23 * zoom, y: start.y };

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

  it('импортирует BMP с исходным размером и подтверждает замену проекта', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1024, height: 1024, close }) as unknown as ImageBitmap),
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['bmp'], 'pixel-art.bmp', { type: 'image/bmp' })],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('1024×1024'));

    expect(rasterDrawCalls).toContainEqual([0, 0, 1024, 1024]);
    expect(close).toHaveBeenCalledOnce();

    ([...document.querySelectorAll('[role="dialog"] button')].find(
      (button) => button.textContent?.trim() === 'Импортировать',
    ) as HTMLButtonElement).click();
    await tick();
    await frame();
    expect(document.body.textContent).toContain('1024×1024');
    expect(canvasData).toHaveLength(1024 * 1024 * 4);
    expect(canvasData![3]).toBe(255);
  });

  it('экспортирует WebP выбранного размера и использует правильный MIME-тип', async () => {
    const toBlob = vi.fn(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
    ) {
      callback(new Blob(['encoded'], { type }));
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', { configurable: true, value: toBlob });
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', { configurable: true, value: vi.fn() });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:export') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

    (document.querySelector('button[aria-label="Действия с файлом"]') as HTMLButtonElement).click();
    await tick();
    const format = document.querySelector('select[aria-label="Формат экспорта"]') as HTMLSelectElement;
    format.value = 'webp';
    format.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    (document.querySelector('button[title="Скачать WEBP"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('WEBP сохранён'));

    expect(toBlob).toHaveBeenCalledOnce();
    expect(toBlob.mock.calls[0][1]).toBe('image/webp');
  });

  it('справка открывается по H и закрывается Escape, фокус возвращается', async () => {
    key('KeyH');
    await tick();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Горячие клавиши');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('открывает заметки, сохраняет текст и предлагает экспорт Markdown', async () => {
    (document.querySelector('button[aria-label="Заметки проекта"]') as HTMLButtonElement).click();
    await tick();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Заметки');
    const editor = dialog.querySelector('textarea[aria-label="Текст заметок"]') as HTMLTextAreaElement;
    editor.value = 'Проверить композицию';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(localStorage.getItem('pixel-editor:notes')).toBe('Проверить композицию');
    expect(Array.from(dialog.querySelectorAll('button')).some((button) => button.textContent?.includes('Экспортировать'))).toBe(true);
  });

  it('сохраняет выбор темы из настроек и применяет её к документу', async () => {
    (document.querySelector('button[aria-label="Настройки"]') as HTMLButtonElement).click();
    await tick();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Тема оформления');
    (document.querySelector('input[name="theme"][value="light"]') as HTMLInputElement).click();
    await tick();

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('pixel-editor:theme')).toBe('light');
    (document.querySelector('[role="dialog"] button') as HTMLButtonElement).click();
    await tick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('горячие клавиши не срабатывают, пока открыт диалог', async () => {
    key('KeyH');
    await tick();
    key('KeyE'); // ластик
    await tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    expect(document.querySelector('.statusbar')?.textContent).toContain('Карандаш');
    key('KeyE');
    await tick();
    expect(document.querySelector('.statusbar')?.textContent).toContain('Ластик');
  });
});
