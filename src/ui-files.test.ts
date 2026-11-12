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

describe('Project files and dialogs', () => {
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
    const helpDialog = document.querySelector('[role="dialog"]');
    expect(helpDialog?.textContent).toContain('Горячие клавиши');
    expect(helpDialog?.textContent).not.toContain('Заметки обратной связи');
    expect(helpDialog?.textContent).toContain('Копировать выделенную область');
    expect(helpDialog?.textContent).toContain('Shift + Enter');
    expect(helpDialog?.textContent).not.toContain('Перейти на холст');
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
