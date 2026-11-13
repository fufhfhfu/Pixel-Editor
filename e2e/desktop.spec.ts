import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const electronExecutable = require('electron') as string;
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
  'base64',
);

let electronApp: ElectronApplication;
let page: Page;
let userDataPath: string;

test.describe.serial('Основные пользовательские потоки Electron', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    userDataPath = await mkdtemp(join(tmpdir(), 'pixel-editor-desktop-e2e-'));
    electronApp = await electron.launch({
      executablePath: electronExecutable,
      args: [process.cwd(), `--user-data-dir=${userDataPath}`],
    });
    page = await electronApp.firstWindow();
    page.on('pageerror', (error) => console.error('Electron renderer error:', error.stack ?? error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error('Electron renderer console error:', message.text());
    });
    await expect(page.getByRole('heading', { name: 'Pixel Editor' })).toBeVisible({ timeout: 60_000 });
    await expect.poll(() =>
      page.evaluate(() => typeof window.pixelEditorDesktop?.saveFile),
    ).toBe('function');

    const welcomeButton = page.getByRole('button', { name: 'Начать работу' });
    if (await welcomeButton.count()) await welcomeButton.click();

    await electronApp.evaluate(({ dialog }, directory) => {
      Object.defineProperty(dialog, 'showSaveDialog', {
        configurable: true,
        value: async (_window: unknown, options: { defaultPath?: string }) => ({
          canceled: false,
          filePath: `${directory}\\${options.defaultPath ?? 'pixel-editor-export'}`,
        }),
      });
    }, userDataPath);
  });

  test.afterAll(async () => {
    test.setTimeout(30_000);
    await electronApp?.close();
    await rm(userDataPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  });

  test('creates, saves, and opens a project', async () => {
    await page.locator('.bar button[title^="Сохранить проект"]').click();
    await expect(page.getByRole('status')).toContainText('Проект сохранён в файл.');

    const savedProjectPath = join(userDataPath, 'pixel-art-1-canvases.json');
    const savedProject = JSON.parse(await readFile(savedProjectPath, 'utf8')) as {
      format: string;
      version: number;
      canvases: unknown[];
    };
    expect(savedProject.format).toBe('pixel-editor-project');
    expect(savedProject.version).toBeGreaterThanOrEqual(1);
    expect(savedProject.canvases).toHaveLength(1);

    const importedProjectPath = join(userDataPath, 'imported-project.json');
    await writeFile(importedProjectPath, JSON.stringify({
      format: 'pixel-editor-project',
      version: 1,
      savedAt: '2026-11-12T00:00:00.000Z',
      width: 8,
      height: 8,
      pixels: Buffer.alloc(8 * 8 * 4).toString('base64'),
      palette: { id: 'pico8', freeColor: false },
      colors: { primary: [255, 0, 77, 255], secondary: [255, 241, 232, 255] },
      recent: [],
    }));

    await page.locator('.menu-bar [data-menu="Файл"]').click();
    await page.getByRole('menuitem', { name: 'Открыть…' }).click();
    await page.locator('.menu-bar input[type="file"]').setInputFiles(importedProjectPath);
    await page.getByRole('dialog', { name: 'Открыть проект?' }).getByRole('button', { name: 'Открыть', exact: true }).click();

    await expect(page.locator('.board.selected > canvas:not(.transform-preview):not(.selection-overlay)'))
      .toHaveJSProperty('width', 8);
    await expect(page.getByRole('status')).toContainText('Проект открыт.');
  });

  test('draws and supports Undo/Redo', async () => {
    const undo = page.getByRole('button', { name: 'Отменить' });
    const redo = page.getByRole('button', { name: 'Повторить' });
    const canvas = page.locator('.board.selected > canvas:not(.transform-preview):not(.selection-overlay)');
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error('Активный холст не отображается.');

    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(undo).toBeEnabled();
  });

  test('imports an image and exports a PNG', async () => {
    await page.locator('.menu-bar [data-menu="Файл"]').click();
    await page.getByRole('menuitem', { name: 'Открыть…' }).click();
    await page.locator('.menu-bar input[type="file"]').setInputFiles({
      name: 'one-pixel.png',
      mimeType: 'image/png',
      buffer: onePixelPng,
    });
    await page.getByRole('dialog', { name: 'Импортировать изображение?' })
      .getByRole('button', { name: 'Импортировать', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Фото импортировано отдельным слоем на выбранный холст.');

    await page.getByRole('button', { name: 'Действия с файлом' }).click();
    await page.locator('.file-menu-panel button[title="Сохранить PNG"]').click();
    await expect(page.getByRole('status')).toContainText('PNG сохранён');

    const png = await readFile(join(userDataPath, 'pixel-art-8x8@4x.png'));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });

  test('edits settings and keeps keyboard focus inside the dialog', async () => {
    const settingsTrigger = page.getByRole('button', { name: 'Настройки' });
    await settingsTrigger.click();
    const dialog = page.getByRole('dialog', { name: 'Настройки' });
    const closeButton = dialog.getByRole('button', { name: 'Закрыть' });
    await dialog.getByRole('tab', { name: 'Клавиши' }).click();

    const hiddenImport = dialog.locator('input[aria-label="Файл схемы горячих клавиш"]');
    await expect(hiddenImport).toBeHidden();
    const lastShortcutButton = dialog.getByRole('button', {
      name: /Назначить последовательность клавиш для действия/u,
    }).last();
    await lastShortcutButton.focus();
    await page.keyboard.press('Tab');
    await expect(closeButton).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(lastShortcutButton).toBeFocused();
    expect(await hiddenImport.evaluate((element) => element === document.activeElement)).toBe(false);

    await dialog.getByRole('tab', { name: 'Общие' }).click();
    await dialog.locator('input[name="theme"][value="light"]').check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await closeButton.click();
    await expect(dialog).toBeHidden();
    await expect(settingsTrigger).toBeFocused();
  });

  test('adds multiple canvases', async () => {
    await page.getByRole('button', { name: 'Добавить холст' }).click();
    await expect(page.locator('.board')).toHaveCount(2);
    await expect(page.locator('.board.selected')).toHaveCount(1);
  });

  test('imports project notes from Markdown', async () => {
    await page.locator('.menu-bar [data-menu="Файл"]').click();
    await page.getByRole('menuitem', { name: 'Заметки проекта…' }).click();
    await page.locator('input[accept*=".markdown"]').setInputFiles({
      name: 'project-notes.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Project notes\n\nImport works in Electron.'),
    });

    await expect(page.getByRole('textbox', { name: 'Текст заметок' }))
      .toHaveValue('# Project notes\n\nImport works in Electron.');
  });
});
