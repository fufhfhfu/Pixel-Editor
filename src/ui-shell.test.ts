// @vitest-environment jsdom
import { flushSync, tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_KEY } from './core/storage';
import { parseProject, type ProjectData } from './core/project';
import { computeFloodFillOutput, type FloodFillWorkerRequest } from './core/tools/floodFillWorker';
import {
  canvasAlpha,
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

describe('UI shell and editor controls', () => {
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

  it('показывает настройки текстовой кнопкой после меню окна', async () => {
    const windowButton = document.querySelector<HTMLButtonElement>('.menu-bar [data-menu="Окно"]')!;
    const settingsButton = document.querySelector<HTMLButtonElement>('.menu-bar [aria-label="Настройки"]')!;
    const saveButton = document.querySelector<HTMLButtonElement>('.bar button[title^="Сохранить проект"]')!;
    const menuButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.menu-bar button'));
    expect(settingsButton.textContent?.trim()).toBe('Настройки');
    expect(menuButtons.indexOf(settingsButton)).toBe(menuButtons.indexOf(windowButton) + 1);
    expect(saveButton).toBeTruthy();

    settingsButton.click();
    await tick();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Тема оформления');
  });

  it('объединяет команды вида и находит команды через поиск', async () => {
    const groups = Array.from(document.querySelectorAll<HTMLButtonElement>('.menu-bar [data-menu]'));
    expect(groups).toHaveLength(9);
    expect(groups.some((button) => button.dataset.menu === 'Изображение')).toBe(false);

    document.querySelector<HTMLButtonElement>('[data-menu="Вид"]')!.click();
    await tick();
    const viewItems = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(viewItems.filter((button) => button.textContent?.includes('Вписать холсты'))).toHaveLength(1);
    expect(viewItems.filter((button) => button.textContent?.includes('Центрировать холст'))).toHaveLength(1);

    document.querySelector<HTMLButtonElement>('[aria-label="Поиск команд"]')!.click();
    await tick();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="command-search-title"]')!;
    const input = dialog.querySelector<HTMLInputElement>('[aria-label="Поиск команд"]')!;
    expect(document.activeElement).toBe(input);
    input.value = 'сетку';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    const result = dialog.querySelector<HTMLButtonElement>('[role="option"]')!;
    expect(result).toBeTruthy();
    const selectedLabel = result.querySelector('span')?.textContent?.trim();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await tick();
    expect(document.querySelector('[aria-labelledby="command-search-title"]')).toBeNull();

    document.querySelector<HTMLButtonElement>('[data-menu="Вид"]')!.click();
    await tick();
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain(selectedLabel);

    document.querySelector<HTMLButtonElement>('[data-menu="Вид"]')!.click();
    const previousFocus = document.activeElement;
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyP',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));
    await tick();
    expect(document.querySelector('[aria-labelledby="command-search-title"]')).toBeTruthy();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await tick();
    expect(document.querySelector('[aria-labelledby="command-search-title"]')).toBeNull();
    expect(document.activeElement).toBe(previousFocus);
  });

  it('переносит заметки обратной связи на верхнюю панель рядом со справкой', async () => {
    const helpButton = document.querySelector<HTMLButtonElement>('.bar [aria-label="Справка"]')!;
    const notesButton = document.querySelector<HTMLButtonElement>('.bar [aria-label="Заметки обратной связи"]')!;
    const toolbarButtons = Array.from(helpButton.parentElement!.querySelectorAll('button'));
    expect(toolbarButtons.indexOf(notesButton)).toBe(toolbarButtons.indexOf(helpButton) + 1);
    expect(document.querySelector('.menu-bar [data-menu="Справка"]')).toBeNull();

    notesButton.click();
    await tick();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Заметки обратной связи');
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
    await remountApp(project);
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
    await vi.waitFor(async () => {
      await tick();
      expect(document.querySelector('.fill-overlay')).toBeNull();
    }, { timeout: 2_000, interval: 20 });
    expect(canvasAlpha(4, 4)).toBe(255);
    key('KeyZ', { ctrlKey: true });
    await vi.waitFor(() => {
      expect(canvasAlpha(4, 4)).toBe(0);
    }, { timeout: 2_000, interval: 20 });
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
    await vi.waitFor(async () => {
      await tick();
      const serialized = localStorage.getItem(AUTOSAVE_KEY);
      expect(serialized).not.toBeNull();
      const saved = parseProject(serialized!);
      expect(saved.customPalettes?.[0]?.name).toBe('UI Palette');
      expect(saved.metadata).toEqual({ title: 'UI test' });
    }, { timeout: 2_000, interval: 20 });
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


});
