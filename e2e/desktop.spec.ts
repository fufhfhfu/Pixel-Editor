import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

async function clickNativeMenuItem(menuLabel: string, itemLabel: string): Promise<void> {
  await electronApp.evaluate(({ Menu, BrowserWindow }, labels) => {
    const menuItem = Menu.getApplicationMenu()?.items
      .find((item) => item.label === labels.menuLabel)?.submenu?.items
      .find((item) => item.label === labels.itemLabel);
    const window = BrowserWindow.getAllWindows()[0];
    if (!menuItem?.click || !window) {
      throw new Error(`В нативном меню не найдена команда «${labels.itemLabel}».`);
    }
    menuItem.click(menuItem, window, undefined!);
  }, { menuLabel, itemLabel });
}

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
    await expect.poll(() =>
      electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label) ?? []),
    ).toEqual(['Файл', 'Правка', 'Вид', 'Холст', 'Слой', 'Кадр', 'Анимация', 'Инструменты', 'Окно']);
    await expect.poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()),
    ).toBe('Pixel Editor');

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
    await expect.poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()),
    ).toBe('Pixel Editor — pixel-art-1-canvases.pxproj');

    const savedProjectPath = join(userDataPath, 'pixel-art-1-canvases.pxproj');
    const savedProject = JSON.parse(await readFile(savedProjectPath, 'utf8')) as {
      format: string;
      version: number;
      canvases: unknown[];
    };
    expect(savedProject.format).toBe('pixel-editor-project');
    expect(savedProject.version).toBeGreaterThanOrEqual(1);
    expect(savedProject.canvases).toHaveLength(1);

    await electronApp.evaluate(({ dialog }, directory) => {
      Object.defineProperty(dialog, 'showSaveDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePath: `${directory}\\saved-as-project.pxproj` }),
      });
    }, userDataPath);
    await clickNativeMenuItem('Файл', 'Сохранить как…');
    await expect.poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()),
    ).toBe('Pixel Editor — saved-as-project.pxproj');
    await electronApp.evaluate(({ dialog }, directory) => {
      Object.defineProperty(dialog, 'showSaveDialog', {
        configurable: true,
        value: async (_window: unknown, options: { defaultPath?: string }) => ({
          canceled: false,
          filePath: `${directory}\\${options.defaultPath ?? 'pixel-editor-export'}`,
        }),
      });
    }, userDataPath);

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

    await clickNativeMenuItem('Файл', 'Открыть…');
    await page.locator('.menu-bar input[type="file"]').setInputFiles(importedProjectPath);
    await page.getByRole('dialog', { name: 'Открыть проект?' }).getByRole('button', { name: 'Открыть', exact: true }).click();

    await expect(page.locator('.board.selected > canvas:not(.transform-preview):not(.selection-overlay)'))
      .toHaveJSProperty('width', 8);
    await expect(page.getByRole('status')).toContainText('Проект открыт.');
    await expect.poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()),
    ).toBe('Pixel Editor — imported-project.json');
  });

  test('opens a project from the recent-projects list', async () => {
    await clickNativeMenuItem('Файл', 'Недавние проекты…');
    const dialog = page.getByRole('dialog', { name: 'Недавние проекты' });
    await expect(dialog.getByRole('button', { name: /imported-project\.json/u })).toBeVisible();
    await dialog.getByRole('button', { name: /imported-project\.json/u }).click();
    await page.getByRole('dialog', { name: 'Открыть проект?' })
      .getByRole('button', { name: 'Открыть', exact: true }).click();
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
    await expect.poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()),
    ).toBe('Pixel Editor — imported-project.json *');
    await page.locator('.bar button[title^="Сохранить проект"]').click();
    await expect.poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()),
    ).toBe('Pixel Editor — imported-project.json');
  });

  test('restores a project from its latest backup after corruption', async () => {
    const projectPath = join(userDataPath, 'imported-project.json');
    await writeFile(projectPath, '{ broken project');
    await clickNativeMenuItem('Файл', 'Недавние проекты…');
    await page.getByRole('dialog', { name: 'Недавние проекты' })
      .getByRole('button', { name: /imported-project\.json/u }).click();
    await expect(page.getByRole('status')).toContainText('доступна резервная копия');
    await page.getByRole('dialog', { name: 'Восстановить проект из резервной копии?' })
      .getByRole('button', { name: 'Восстановить', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Проект восстановлен из резервной копии.');
    await expect.poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()),
    ).toBe('Pixel Editor — imported-project.json *');
  });

  test('toggles native fullscreen and persists safe window bounds', async () => {
    await clickNativeMenuItem('Вид', 'Полноэкранный режим');
    await expect.poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen()),
    ).toBe(true);
    await expect.poll(() =>
      electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('view-fullscreen')?.checked),
    ).toBe(true);
    await clickNativeMenuItem('Вид', 'Полноэкранный режим');
    await expect.poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen()),
    ).toBe(false);
    await expect.poll(() =>
      electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('view-fullscreen')?.checked),
    ).toBe(false);

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 120, y: 100, width: 1100, height: 760 });
    });
    await expect.poll(async () => {
      const state = JSON.parse(await readFile(join(userDataPath, 'window-state.json'), 'utf8')) as {
        bounds: { x: number; y: number; width: number; height: number };
      };
      return state.bounds;
    }, { timeout: 5_000 }).toEqual({ x: 120, y: 100, width: 1100, height: 760 });
  });

  test('imports an image and exports a PNG', async () => {
    await page.evaluate((encodedImage) => {
      const bytes = Uint8Array.from(atob(encodedImage), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'one-pixel.png', { type: 'image/png' }));
      window.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    }, onePixelPng.toString('base64'));
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

  test('exports all canvases to a selected folder', async () => {
    await electronApp.evaluate(({ dialog }, directory) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [directory] }),
      });
    }, userDataPath);
    await clickNativeMenuItem('Файл', 'Пакетный экспорт холстов…');
    await expect(page.getByRole('status')).toContainText('Экспортировано холстов: 2.');
    const exportedFiles = (await readdir(userDataPath)).filter((name) =>
      /^pixel-editor-\d{13}-canvas-[12]-\d+x\d+\.png$/u.test(name),
    );
    expect(exportedFiles).toHaveLength(2);
  });

  test('opens a project sent by a second application launch', async () => {
    const projectPath = join(userDataPath, 'command-line-project.pxproj');
    await writeFile(projectPath, JSON.stringify({
      format: 'pixel-editor-project',
      version: 1,
      savedAt: '2026-11-12T00:00:00.000Z',
      width: 7,
      height: 7,
      pixels: Buffer.alloc(7 * 7 * 4).toString('base64'),
      palette: { id: 'pico8', freeColor: false },
      colors: { primary: [255, 0, 77, 255], secondary: [255, 241, 232, 255] },
      recent: [],
    }));
    await electronApp.evaluate(({ app }, filePath) => {
      app.emit('second-instance', {}, [process.execPath, filePath], process.cwd());
    }, projectPath);
    await page.getByRole('dialog', { name: 'Открыть проект?' })
      .getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(page.locator('.board.selected > canvas:not(.transform-preview):not(.selection-overlay)'))
      .toHaveJSProperty('width', 7);
  });

  test('keeps the window open when closing a dirty project is cancelled', async () => {
    const canvas = page.locator('.board.selected > canvas:not(.transform-preview):not(.selection-overlay)');
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error('Активный холст не отображается.');
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect.poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()),
    ).toContain(' *');
    await electronApp.evaluate(({ dialog, BrowserWindow }) => {
      const originalShowMessageBox = dialog.showMessageBox;
      Object.defineProperty(dialog, 'showMessageBox', {
        configurable: true,
        value: async () => ({ response: 2 }),
      });
      BrowserWindow.getAllWindows()[0]?.close();
      Object.defineProperty(dialog, 'showMessageBox', {
        configurable: true,
        value: originalShowMessageBox,
      });
    });
    await expect.poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()),
    ).toContain(' *');
  });

  test('imports project notes from Markdown', async () => {
    await clickNativeMenuItem('Файл', 'Заметки проекта…');
    const notesDialog = page.getByRole('dialog', { name: 'Заметки' });
    await page.locator('input[accept*=".markdown"]').setInputFiles({
      name: 'project-notes.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Project notes\n\nImport works in Electron.'),
    });

    const notesEditor = page.getByRole('textbox', { name: 'Текст заметок' });
    await expect(notesEditor)
      .toHaveValue('# Project notes\n\nImport works in Electron.');
    const noteTitle = notesDialog.getByRole('textbox', { name: 'Название заметки' });
    await noteTitle.fill('Project notebook');
    await expect.poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()),
    ).toContain(' *');
    const search = notesDialog.getByRole('searchbox', { name: 'Поиск в заметках' });
    await search.fill('works');
    await notesDialog.getByRole('button', { name: 'Следующее совпадение' }).click();
    await expect.poll(() => notesEditor.evaluate((element: HTMLTextAreaElement) => ({
      selected: element.value.slice(element.selectionStart, element.selectionEnd),
    }))).toEqual({ selected: 'works' });

    await notesDialog.getByRole('combobox', { name: 'Формат экспорта заметок' }).selectOption('pdf');
    await notesDialog.getByRole('button', { name: 'Экспортировать' }).click();
    await expect.poll(async () => {
      try {
        return (await readFile(join(userDataPath, 'pixel-editor-notes.pdf'))).subarray(0, 4).toString();
      } catch {
        return '';
      }
    }, { timeout: 15_000 }).toBe('%PDF');

    await notesDialog.getByRole('button', { name: 'Закрыть' }).click();
    await page.locator('.bar button[title^="Сохранить проект"]').click();
    await expect(page.getByRole('status')).toContainText('Проект сохранён в файл.');
    const savedFileName = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getTitle().split(' — ').at(-1),
    );
    if (!savedFileName) throw new Error('В заголовке окна не указано имя сохранённого проекта.');
    const savedNotesProject = JSON.parse(await readFile(join(userDataPath, savedFileName), 'utf8')) as {
      notesMetadata: { title: string; createdAt: number; updatedAt: number };
    };
    expect(savedNotesProject.notesMetadata.title).toBe('Project notebook');
    expect(savedNotesProject.notesMetadata.createdAt).toBeGreaterThan(0);
    expect(savedNotesProject.notesMetadata.updatedAt).toBeGreaterThanOrEqual(savedNotesProject.notesMetadata.createdAt);

    await electronApp.close();
    electronApp = await electron.launch({
      executablePath: electronExecutable,
      args: [process.cwd(), `--user-data-dir=${userDataPath}`],
    });
    page = await electronApp.firstWindow();
    await expect(page.getByRole('heading', { name: 'Pixel Editor' })).toBeVisible({ timeout: 60_000 });
    await electronApp.evaluate(({ dialog }, directory) => {
      Object.defineProperty(dialog, 'showSaveDialog', {
        configurable: true,
        value: async (_window: unknown, options: { defaultPath?: string }) => ({
          canceled: false,
          filePath: `${directory}\\${options.defaultPath ?? 'pixel-editor-export'}`,
        }),
      });
    }, userDataPath);
    await expect.poll(() => page.evaluate(() => window.pixelEditorDesktop?.getNotesBackup()))
      .toMatchObject({ title: 'Project notebook', notes: '# Project notes\n\nImport works in Electron.' });
    await clickNativeMenuItem('Файл', 'Заметки проекта…');
    const reopenedNotes = page.getByRole('dialog', { name: 'Заметки' });
    await expect(reopenedNotes.getByRole('textbox', { name: 'Название заметки' })).toHaveValue('Project notebook');
    await reopenedNotes.getByRole('textbox', { name: 'Текст заметок' }).fill('Changed after reopening.');
    await reopenedNotes.getByRole('button', { name: 'Восстановить копию' }).click();
    await expect(reopenedNotes.getByRole('textbox', { name: 'Текст заметок' }))
      .toHaveValue('# Project notes\n\nImport works in Electron.');
    await reopenedNotes.getByRole('button', { name: 'Закрыть' }).click();
    await page.locator('.bar button[title^="Сохранить проект"]').click();
    await expect(page.getByText('Проект сохранён в файл.')).toBeVisible();
  });
});
