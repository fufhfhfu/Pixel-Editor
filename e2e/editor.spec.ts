import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function createPng(page: import('@playwright/test').Page, width: number, height: number): Promise<Buffer> {
  const base64 = await page.evaluate(async ({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D недоступен в браузере теста.');
    context.fillStyle = '#7c5cff';
    context.fillRect(0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Не удалось создать PNG fixture.'))), 'image/png'),
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }, { width, height });
  return Buffer.from(base64, 'base64');
}

async function importPng(page: import('@playwright/test').Page, width = 1024, height = 512): Promise<void> {
  const png = await createPng(page, width, height);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'source-art.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(page.getByRole('dialog')).toContainText(`${width}×${height}`);
  await page.getByRole('button', { name: 'Импортировать', exact: true }).click();
  await expect(page.getByText(`${width}×${height}`, { exact: true }).first()).toBeVisible();
}

test('imports exact dimensions, autosaves to IndexedDB, restores and exports lossless PNG to a chosen location', async ({ page }) => {
  await page.goto('/');
  await importPng(page);

  await expect(page.locator('.statusbar .save')).toContainText('сохранено в', { timeout: 10_000 });
  const importedPixel = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    return Array.from(canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data);
  });
  expect(importedPixel).toEqual([124, 92, 255, 255]);

  await page.reload();
  await expect(page.getByText('1024×512', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.statusbar .save')).toHaveText('включено');

  await page.evaluate(() => {
    window.pixelEditorDesktop = {
      saveFile: async (request) => {
        localStorage.setItem('test-save-name', request.suggestedName);
        localStorage.setItem('test-save-type', request.mimeType);
        localStorage.setItem('test-save-size', String(request.data.byteLength));
        return 'saved';
      },
    };
  });

  await page.locator('button[title="Сохранить проект в файл JSON (Ctrl+S)"]').click();
  await expect(page.locator('.toast')).toContainText('Проект сохранён в файл');
  const projectSave = await page.evaluate(() => ({
    name: localStorage.getItem('test-save-name'),
    type: localStorage.getItem('test-save-type'),
    size: Number(localStorage.getItem('test-save-size')),
  }));
  expect(projectSave.name).toMatch(/\.json$/);
  expect(projectSave.type).toBe('application/json');
  expect(projectSave.size).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Действия с файлом' }).click();
  const menuZIndex = await page.locator('.file-menu-panel').evaluate((element) => {
    const panel = Number(getComputedStyle(element).zIndex);
    const header = Number(getComputedStyle(element.closest('.bar')!).zIndex);
    return { panel, header };
  });
  expect(menuZIndex.panel).toBeGreaterThan(menuZIndex.header);
  await page.getByRole('button', { name: /Экспорт 4096×2048/ }).click();
  await expect(page.locator('.toast')).toContainText('PNG сохранён: 4096×2048');
  const saved = await page.evaluate(() => ({
    name: localStorage.getItem('test-save-name'),
    type: localStorage.getItem('test-save-type'),
    size: Number(localStorage.getItem('test-save-size')),
  }));
  expect(saved.name).toContain('@4x.png');
  expect(saved.type).toBe('image/png');
  expect(saved.size).toBeGreaterThan(0);
});

test('migrates the legacy localStorage autosave to IndexedDB before opening the editor', async ({ page }) => {
  await page.addInitScript(() => {
    const pixels = btoa(String.fromCharCode(10, 20, 30, 255));
    const project = {
      format: 'pixel-editor-project',
      version: 1,
      savedAt: '2026-01-01T00:00:00.000Z',
      width: 1,
      height: 1,
      pixels,
      palette: { id: 'pico8', freeColor: false },
      colors: { primary: [255, 0, 77, 255], secondary: [255, 241, 232, 255] },
      recent: [],
    };
    localStorage.setItem('pixel-editor:autosave', JSON.stringify(project));
  });
  await page.goto('/');

  await expect(page.getByText('1×1', { exact: true }).first()).toBeVisible();
  const migration = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pixel-editor', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction('projects', 'readonly');
      const request = transaction.objectStore('projects').get('latest');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return { legacy: localStorage.getItem('pixel-editor:autosave'), value };
  });
  expect(migration.legacy).toBeNull();
  expect(migration.value).toContain('"width":1');
});

test('keeps modal interactions keyboard accessible and has no axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pixel Editor', level: 1 })).toBeVisible();
  const initialAudit = await new AxeBuilder({ page }).analyze();
  expect(initialAudit.violations).toEqual([]);

  await page.getByRole('button', { name: 'Горячие клавиши' }).click();
  const dialog = page.getByRole('dialog', { name: 'Горячие клавиши' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused();
  const dialogAudit = await new AxeBuilder({ page }).analyze();
  expect(dialogAudit.violations).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Горячие клавиши' })).toBeFocused();

  await page.getByRole('button', { name: 'Настройки' }).click();
  const settings = page.getByRole('dialog', { name: 'Настройки' });
  await expect(settings).toBeVisible();
  const settingsAudit = await new AxeBuilder({ page }).analyze();
  expect(settingsAudit.violations).toEqual([]);
  await expect(settings.getByText('Папка для сохранения')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Светлая' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('radio', { name: 'Системная' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(page.getByRole('button', { name: 'Настройки' })).toBeFocused();

  await page.getByRole('button', { name: 'Действия с файлом' }).click();
  await expect(page.getByRole('group', { name: 'Открытие и экспорт' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'Открытие и экспорт' })).toBeHidden();
});
