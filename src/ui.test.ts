// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.svelte';
import { AutosaveRepository } from './core/autosave';
import { AUTOSAVE_KEY } from './core/storage';
import { parseProject, type ProjectData } from './core/project';
import { computeFloodFillOutput, type FloodFillWorkerRequest } from './core/tools/floodFillWorker';
import { WELCOME_SEEN_KEY } from './core/feedbackNotes';

/** Заглушки DOM-возможностей, отсутствующих в jsdom. */
interface PutCall {
  dirty: [number, number, number, number];
}
const putCalls: PutCall[] = [];
let canvasData: Uint8ClampedArray | null = null;
const rasterDrawCalls: number[][] = [];
const desktopSaveFile = vi.fn(async () => 'saved' as const);

function installDomStubs(): void {
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: () => unknown };
  proto.getContext = function (this: HTMLCanvasElement) {
    const canvas = this;
    return {
      putImageData(image: { data: Uint8ClampedArray }, _dx: number, _dy: number, x: number, y: number, w: number, h: number) {
        if (canvas.classList.contains('thumbnail') || canvas.classList.contains('selection-overlay') ||
          canvas.classList.contains('transform-preview') || canvas.classList.contains('reference-image')) return;
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

async function mountApp(initialProject?: ProjectData): Promise<void> {
  const repository = new AutosaveRepository(null, localStorage);
  const startup = await repository.load();
  app = mount(App, {
    target: document.getElementById('app')!,
    props: {
      initialProject: initialProject ?? startup.project,
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
  installDomStubs();
  putCalls.length = 0;
  canvasData = null;
  rasterDrawCalls.length = 0;
  desktopSaveFile.mockClear();
  localStorage.clear();
  localStorage.setItem(WELCOME_SEEN_KEY, 'true');
  Object.defineProperty(window, 'pixelEditorDesktop', {
    configurable: true,
    value: { saveFile: desktopSaveFile },
  });
  document.body.innerHTML = '<div id="app"></div>';
  await mountApp();
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  delete (window as Window & { pixelEditorDesktop?: unknown }).pixelEditorDesktop;
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

  it('масштабирует холст вокруг точки под курсором при прокрутке колеса', async () => {
    const zoomAnchor = screenOf(5, 7);

    viewport().dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: zoomAnchor.x,
      clientY: zoomAnchor.y,
      deltaY: -100,
    }));
    await tick();

    const anchorAfter = screenOf(5, 7);
    expect(anchorAfter.x).toBeCloseTo(zoomAnchor.x);
    expect(anchorAfter.y).toBeCloseTo(zoomAnchor.y);
  });

  it('позволяет скрыть правую панель и вернуть её с края рабочей области', async () => {
    expect(document.querySelector('.palette-dock')).toBeTruthy();
    document.querySelector<HTMLButtonElement>('[aria-label="Скрыть правую панель"]')!.click();
    await tick();

    expect(document.querySelector('.palette-dock')).toBeNull();
    document.querySelector<HTMLButtonElement>('[aria-label="Показать правую панель"]')!.click();
    await tick();

    expect(document.querySelector('.palette-dock')).toBeTruthy();
  });

  it('не дублирует команды отмены, масштабирования и экспорта в правой панели', async () => {
    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.panel-tabs button'));
    const selectTab = async (label: string) => {
      const tab = tabs.find((entry) => entry.textContent?.trim() === label);
      expect(tab).toBeTruthy();
      tab!.click();
      await tick();
    };

    await selectTab('History');
    expect(document.querySelectorAll<HTMLButtonElement>('[aria-label="Отменить"]')).toHaveLength(1);
    expect(document.querySelectorAll<HTMLButtonElement>('[aria-label="Повторить"]')).toHaveLength(1);

    await selectTab('Navigator');
    expect(document.querySelectorAll<HTMLButtonElement>('button[title="Центрировать активный холст"]')).toHaveLength(1);
    expect(document.querySelectorAll<HTMLButtonElement>('[aria-label="Увеличить"]')).toHaveLength(1);
    expect(document.querySelectorAll<HTMLButtonElement>('[aria-label="Уменьшить"]')).toHaveLength(1);
    expect(document.querySelectorAll<HTMLButtonElement>('button[title="Показать активный холст в масштабе 100%"]')).toHaveLength(1);
    expect(document.querySelectorAll<HTMLButtonElement>('button[title="Вписать холст в окно (F)"]')).toHaveLength(1);
    expect(document.querySelectorAll<HTMLButtonElement>('button[title="Открыть активный холст в отдельном окне предпросмотра"]')).toHaveLength(1);

    await selectTab('Export');
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.panel-content button'))
      .some((button) => button.textContent?.trim() === 'Экспортировать')).toBe(false);
    document.querySelector<HTMLButtonElement>('[data-menu="Файл"]')!.click();
    await tick();
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .some((button) => button.textContent?.includes('Экспорт изображения'))).toBe(true);
  });

  it('упрощает левую панель и оставляет режимы выделения в меню «Правка»', async () => {
    const toolPanel = document.querySelector<HTMLElement>('[aria-label="Инструменты"]')!;
    expect(toolPanel.querySelectorAll('button.tool').length).toBeGreaterThan(0);
    expect(toolPanel.querySelector('.options > summary')?.textContent).toContain('⚙');
    expect(toolPanel.querySelector('[aria-label="Размер кисти"]')).toBeNull();
    expect(toolPanel.querySelector('[aria-label="Форма кисти"]')).toBeNull();
    expect(toolPanel.textContent).not.toContain('Выделение');
    expect(toolPanel.textContent).not.toContain('Библиотека кистей');

    document.querySelector<HTMLButtonElement>('[data-menu="Правка"]')!.click();
    await tick();
    const rectSelection = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent?.includes('Выделение: прямоугольник'))!;
    expect(rectSelection).toBeTruthy();
    rectSelection.click();
    await tick();
    expect(document.querySelector('[role="menu"]')).toBeNull();

    document.querySelector<HTMLButtonElement>('[data-menu="Правка"]')!.click();
    await tick();
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Снять режим выделения');
  });

  it('группирует фигуры в безымянной кнопке и закрывает меню после выбора', () => {
    const menu = document.querySelector<HTMLElement>('.shape-menu')!;
    const folder = menu.querySelector<HTMLButtonElement>('.shape-folder')!;
    expect(folder.textContent?.trim()).toBe('');
    expect(folder.getAttribute('aria-expanded')).toBe('false');

    folder.click();
    flushSync();
    expect(folder.getAttribute('aria-expanded')).toBe('true');
    expect(menu.querySelectorAll('.shape-menu-panel button')).toHaveLength(11);

    menu.querySelector<HTMLButtonElement>('[aria-label="Эллипс (O)"]')!.click();
    flushSync();
    expect(folder.getAttribute('aria-expanded')).toBe('false');
    expect(menu.querySelector('.shape-menu-panel')).toBeNull();
    expect(folder.classList.contains('active')).toBe(true);
  });

  it('открывает менеджер референсов из панели холста', () => {
    const toggle = Array.from(document.querySelectorAll<HTMLButtonElement>('.toolbar button'))
      .find((button) => button.textContent?.trim() === 'Референсы');
    expect(toggle).toBeTruthy();
    toggle!.click();
    flushSync();
    expect(document.querySelector('[aria-label="Менеджер референсов"]')).toBeTruthy();
    document.querySelector<HTMLButtonElement>('[aria-label="Закрыть панель референсов"]')!.click();
    flushSync();
    expect(document.querySelector('[aria-label="Менеджер референсов"]')).toBeNull();
  });

  it('пипетка выбирает точный цвет с видимого референса', async () => {
    const project: ProjectData = {
      width: 32,
      height: 32,
      pixels: new Uint8ClampedArray(32 * 32 * 4),
      paletteId: 'pico8',
      freeColor: true,
      primary: { r: 0, g: 0, b: 0, a: 255 },
      secondary: { r: 255, g: 255, b: 255, a: 255 },
      recent: [],
      references: [{
        id: 'ref',
        name: 'swatches.png',
        width: 2,
        height: 1,
        pixels: new Uint8ClampedArray([12, 34, 56, 255, 78, 90, 123, 128]),
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      }],
    };
    if (app) unmount(app);
    app = null;
    await mountApp(project);
    await frame();
    document.querySelector<HTMLButtonElement>('[aria-label^="Пипетка"]')!.click();
    flushSync();
    pointer('pointerdown', screenOf(0, 0));
    expect(document.querySelector<HTMLInputElement>('.big.primary input')?.value).toBe('#0c2238');
  });

  it('выполняет заливку через Worker, блокирует ввод и сохраняет Undo', async () => {
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;

      postMessage(request: FloodFillWorkerRequest): void {
        const pixels = computeFloodFillOutput(request);
        queueMicrotask(() => this.onmessage?.({ data: { pixels: pixels.buffer } } as MessageEvent));
      }

      terminate(): void {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    await frame();
    document.querySelector<HTMLButtonElement>('[aria-label="Заливка (B)"]')!.click();
    flushSync();
    pointer('pointerdown', screenOf(4, 4));
    expect(document.querySelector('.fill-overlay')?.textContent).toContain('Выполняется заливка');
    await frame();
    await frame();
    expect(document.querySelector('.fill-overlay')).toBeNull();
    expect(canvasAlpha(4, 4)).toBe(255);
    key('KeyZ', { ctrlKey: true });
    await frame();
    expect(canvasAlpha(4, 4)).toBe(0);
  });

  it('сохраняет созданную пользовательскую палитру и метаданные в проекте', async () => {
    vi.useFakeTimers();
    document.querySelector<HTMLElement>('.custom-palette summary')!.click();
    flushSync();
    const name = document.querySelector<HTMLInputElement>('[aria-label="Название пользовательской палитры"]')!;
    const colors = document.querySelector<HTMLTextAreaElement>('[aria-label="Цвета пользовательской палитры"]')!;
    name.value = 'UI Palette';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    colors.value = '#112233\n#445566';
    colors.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    document.querySelector<HTMLButtonElement>('.custom-palette button')!.click();
    flushSync();
    expect((document.querySelector('[aria-label="Пресет палитры"]') as HTMLSelectElement).value).toMatch(/^custom-/);

    document.querySelector<HTMLButtonElement>('.panel-tabs button:nth-child(4)')!.click();
    flushSync();
    const metadata = document.querySelector<HTMLTextAreaElement>('#project-metadata')!;
    metadata.value = '{"title":"UI test"}';
    metadata.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    document.querySelector<HTMLButtonElement>('.metadata-panel button')!.click();
    flushSync();

    await vi.advanceTimersByTimeAsync(1000);
    const saved = parseProject(localStorage.getItem(AUTOSAVE_KEY)!);
    expect(saved.customPalettes?.[0]?.name).toBe('UI Palette');
    expect(saved.metadata).toEqual({ title: 'UI test' });
  });

  it('назначает последовательность клавиш инструменту и распознаёт её', async () => {
    document.querySelector<HTMLButtonElement>('button[aria-label="Настройки"]')!.click();
    await tick();
    document.querySelector<HTMLButtonElement>('#settings-hotkeys-tab')!.click();
    await tick();
    const row = Array.from(document.querySelectorAll<HTMLElement>('.shortcut-row'))
      .find((entry) => entry.textContent?.includes('Инструмент: Пипетка'))!;
    row.querySelector<HTMLButtonElement>('.assign[aria-label*="последовательность"]')!.click();
    flushSync();
    key('KeyQ');
    key('KeyW');
    Array.from(row.querySelectorAll<HTMLButtonElement>('.assign'))
      .find((button) => button.textContent?.includes('Завершить'))?.click();
    flushSync();
    expect(row.textContent).toContain('Q → W');
    document.querySelector<HTMLButtonElement>('[role="dialog"] header button')!.click();
    flushSync();
    key('KeyQ');
    expect(document.querySelector('.shortcut-sequence-hint')?.textContent).toContain('Q');
    key('KeyW');
    expect(document.querySelector<HTMLButtonElement>('[aria-label^="Пипетка"]')?.getAttribute('aria-pressed')).toBe('true');
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

  it('правый клик не открывает меню удаления; удаление холста доступно в меню и отменяется', async () => {
    (document.querySelector('.add-board') as HTMLButtonElement).click();
    await frame();
    expect(document.querySelectorAll('.board')).toHaveLength(2);

    const point = screenOf(4, 4, 1);
    pointer('pointerdown', point, { button: 2 });
    pointer('pointerup', point, { button: 2 });
    await tick();
    expect(document.querySelector('[role="menu"][aria-label="Действия холста"]')).toBeNull();
    expect(document.querySelectorAll('.board')).toHaveLength(2);

    (document.querySelector('[data-menu="Холст"]') as HTMLButtonElement).click();
    await tick();
    const deleteBoardMenuItem = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent?.trim() === 'Удалить активный холст');
    expect(deleteBoardMenuItem).toBeTruthy();
    deleteBoardMenuItem?.click();
    await frame();
    expect(document.querySelectorAll('.board')).toHaveLength(1);
    expect(document.body.textContent).toContain('Холст удалён');

    (document.querySelector('button[aria-label="Отменить"]') as HTMLButtonElement).click();
    await frame();
    expect(document.querySelectorAll('.board')).toHaveLength(2);
    (document.querySelector('button[aria-label="Повторить"]') as HTMLButtonElement).click();
    await frame();
    expect(document.querySelectorAll('.board')).toHaveLength(1);

    expect(document.querySelector('[data-menu="Холст"]')).toBeTruthy();
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

  it('imports project notes from Markdown into the project notes editor', async () => {
    (document.querySelector('[data-menu="Файл"]') as HTMLButtonElement).click();
    await tick();
    const notesItem = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent?.trim() === 'Заметки проекта…');
    expect(notesItem).toBeTruthy();
    notesItem?.click();
    await tick();

    const input = document.querySelector('input[type="file"][accept*=".markdown"]') as HTMLInputElement;
    const noteFile = new File(['# Imported ideas\n\nTry a cool palette.'], 'ideas.md', { type: 'text/markdown' });
    Object.defineProperty(noteFile, 'text', {
      configurable: true,
      value: async () => '# Imported ideas\n\nTry a cool palette.',
    });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [noteFile],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => {
      expect((document.querySelector('textarea[aria-label="Текст заметок"]') as HTMLTextAreaElement).value)
        .toBe('# Imported ideas\n\nTry a cool palette.');
    });
  });

  it('импортирует фото отдельным слоем только в выбранный холст', async () => {
    (document.querySelector('.add-board') as HTMLButtonElement).click();
    await frame();
    expect(document.querySelectorAll('.board')).toHaveLength(2);

    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 128, height: 64, close }) as unknown as ImageBitmap),
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['bmp'], 'pixel-art.bmp', { type: 'image/bmp' })],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('32×32'));

    expect(rasterDrawCalls).toContainEqual([0, 8, 32, 16]);
    expect(close).toHaveBeenCalledOnce();

    ([...document.querySelectorAll('[role="dialog"] button')].find(
      (button) => button.textContent?.trim() === 'Импортировать',
    ) as HTMLButtonElement).click();
    await tick();
    await frame();
    expect(document.querySelectorAll('.board')).toHaveLength(2);
    expect(document.querySelectorAll('.board.selected')).toHaveLength(1);
    expect((document.querySelector('.board.selected canvas') as HTMLCanvasElement).width).toBe(32);

    (Array.from(document.querySelectorAll<HTMLButtonElement>('.panel-tabs button'))
      .find((button) => button.textContent?.trim() === 'Layers') as HTMLButtonElement).click();
    await tick();
    expect(document.body.textContent).toContain('Фото pixel-art');

    (document.querySelector('button[aria-label="Отменить"]') as HTMLButtonElement).click();
    await tick();
    expect(document.querySelectorAll('.board')).toHaveLength(2);
    expect(document.body.textContent).not.toContain('Фото pixel-art');
    (document.querySelector('button[aria-label="Повторить"]') as HTMLButtonElement).click();
    await tick();
    expect(document.body.textContent).toContain('Фото pixel-art');
  });

  it('экспортирует WebP выбранного размера и использует правильный MIME-тип', async () => {
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new Uint8Array([1]).buffer),
    });
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
    (document.querySelector('button[title="Сохранить WEBP"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('WEBP сохранён'));

    expect(toBlob).toHaveBeenCalledOnce();
    expect(toBlob.mock.calls[0][1]).toBe('image/webp');
    expect(desktopSaveFile).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName: 'pixel-art-32x32@4x.webp',
      mimeType: 'image/webp',
      data: new Uint8Array([1]),
    }));
  });

  it('справка открывается по H и закрывается Escape, фокус возвращается', async () => {
    key('KeyH');
    await tick();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Горячие клавиши');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
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

  it('позволяет переназначить клавишу инструмента и сохраняет контекстную подсказку', async () => {
    (document.querySelector('button[aria-label="Настройки"]') as HTMLButtonElement).click();
    await tick();
    (document.querySelector('#settings-hotkeys-tab') as HTMLButtonElement).click();
    await tick();
    (document.querySelector('[aria-label="Назначить сочетание для действия «Инструмент: Ластик»"]') as HTMLButtonElement).click();
    key('KeyQ');
    await tick();

    expect(localStorage.getItem('pixel-editor:hotkeys')).toContain('"code": "KeyQ"');
    expect(Array.from(document.querySelectorAll('.tool')).map((element) => element.getAttribute('aria-label')).join('|')).toContain('Ластик (E; Q)');
    (document.querySelector('[role="dialog"] button') as HTMLButtonElement).click();
    await tick();
    key('KeyQ');
    expect(document.querySelector('.statusbar')?.textContent).toContain('Ластик');
  });

  it('не применяет конфликтующее назначение клавиши', async () => {
    (document.querySelector('button[aria-label="Настройки"]') as HTMLButtonElement).click();
    await tick();
    (document.querySelector('#settings-hotkeys-tab') as HTMLButtonElement).click();
    await tick();
    (document.querySelector('[aria-label="Назначить сочетание для действия «Инструмент: Ластик»"]') as HTMLButtonElement).click();
    key('KeyP');
    await tick();

    expect(document.querySelector('[role="status"]')?.textContent).toMatch(/уже назначено/i);
    expect(localStorage.getItem('pixel-editor:hotkeys')).toBeNull();
  });

  it('сохраняет клавиши быстрого выбора размера кисти', () => {
    key('Digit7');
    expect(document.querySelector('.value.tool')?.textContent).toContain('7 px');
  });
});
