import { expect, test, type Page } from '@playwright/test';

interface SavedFile {
  suggestedName: string;
  mimeType: string;
  size: number;
  signature: number[];
  width: number;
  height: number;
}

async function openEditor(page: Page, firstRun = false): Promise<void> {
  await page.addInitScript((showWelcome) => {
    const onboardingKey = 'pixel-editor:welcome-seen';
    if (!sessionStorage.getItem('__pixelEditorE2eInitialized')) {
      sessionStorage.setItem('__pixelEditorE2eInitialized', 'true');
      if (showWelcome) localStorage.removeItem(onboardingKey);
      else localStorage.setItem(onboardingKey, 'true');
    }
    const savedFiles: Array<{
      suggestedName: string;
      mimeType: string;
      size: number;
      signature: number[];
      width: number;
      height: number;
    }> = [];
    const notes: Array<{
      number: number;
      title: string;
      category: string;
      description: string;
      createdAt: string;
      updatedAt: string;
    }> = [];
    Object.defineProperty(window, '__pixelEditorSavedFiles', { value: savedFiles });
    Object.defineProperty(window, 'pixelEditorDesktop', {
      value: {
        saveFile: async (request: { suggestedName: string; mimeType: string; data: Uint8Array }) => {
          const bytes = request.data;
          savedFiles.push({
            suggestedName: request.suggestedName,
            mimeType: request.mimeType,
            size: bytes.byteLength,
            signature: Array.from(bytes.subarray(0, 8)),
            width: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16),
            height: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20),
          });
          return 'saved';
        },
        listFeedbackNotes: async () => notes.map((note) => ({ ...note })),
        createFeedbackNote: async (draft: { title: string; category: string; description: string }) => {
          const now = new Date().toISOString();
          const note = { ...draft, number: notes.length + 1, createdAt: now, updatedAt: now };
          notes.push(note);
          return { ...note };
        },
        updateFeedbackNote: async (number: number, draft: { title: string; category: string; description: string }) => {
          const index = notes.findIndex((note) => note.number === number);
          if (index < 0) throw new Error('Заметка не найдена.');
          notes[index] = { ...notes[index]!, ...draft, updatedAt: new Date().toISOString() };
          return { ...notes[index]! };
        },
      },
    });
  }, firstRun);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pixel Editor' })).toBeVisible();
}

test('shows welcome only on first run and can reopen it from the button beside settings', async ({ page }) => {
  await openEditor(page, true);
  const welcome = page.getByRole('dialog', { name: 'Добро пожаловать!' });
  await expect(welcome).toBeVisible();
  await expect(welcome).toContainText('ошибки и сбои');
  await welcome.getByRole('button', { name: 'Начать работу' }).click();
  await expect(welcome).toBeHidden();

  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Добро пожаловать!' })).toBeHidden();
  await page.getByRole('button', { name: 'Приветствие' }).click();
  await expect(page.getByRole('dialog', { name: 'Добро пожаловать!' })).toBeVisible();
});

test('creates, reads and edits notes through the Help section', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Горячие клавиши' }).click();
  await page.getByRole('button', { name: 'Заметки обратной связи' }).click();
  const dialog = page.getByRole('dialog', { name: 'Заметки обратной связи' });
  await expect(dialog.getByText('Заметок пока нет')).toBeVisible();
  await dialog.getByRole('button', { name: 'Создать первую заметку' }).click();
  await dialog.getByLabel('Название').fill('Сохранение пикселей');
  await dialog.getByLabel('Категория').selectOption({ label: 'Ошибка / баг' });
  await dialog.getByLabel('Описание').fill('Первая строка\nВторая строка с кириллицей и 🎨');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog.getByRole('heading', { name: 'Сохранение пикселей' })).toBeVisible();
  await expect(dialog.locator('.description')).toContainText('Вторая строка с кириллицей');

  await dialog.getByRole('button', { name: 'Редактировать' }).click();
  await dialog.getByLabel('Название').fill('Сохранение пикселей исправлено');
  await dialog.getByLabel('Категория').selectOption({ label: 'Улучшение существующего функционала' });
  await dialog.getByLabel('Описание').fill('Обновлённое описание');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog.getByRole('heading', { name: 'Сохранение пикселей исправлено' })).toBeVisible();

  await dialog.getByRole('button', { name: '＋ Новая заметка' }).click();
  await dialog.getByLabel('Название').fill('Новая функция');
  await dialog.getByLabel('Описание').fill('Добавить полезный инструмент.');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog.getByRole('button', { name: /№1 Сохранение пикселей исправлено/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /№2 Новая функция/ })).toBeVisible();
  await dialog.getByRole('button', { name: /№1 Сохранение пикселей исправлено/ }).click();
  await expect(dialog.locator('.note-content').getByText(/ЗАМЕТКА №1/u)).toBeVisible();

  await dialog.getByRole('button', { name: '＋ Новая заметка' }).click();
  await dialog.getByLabel('Название').fill('Черновик');
  await dialog.getByRole('button', { name: 'Закрыть заметки' }).click();
  const discardPrompt = page.getByRole('alertdialog', { name: 'Не сохранённые изменения' });
  await expect(discardPrompt).toBeVisible();
  await discardPrompt.getByRole('button', { name: 'Продолжить редактирование' }).click();
  await dialog.getByRole('button', { name: 'Закрыть заметки' }).click();
  await discardPrompt.getByRole('button', { name: 'Не сохранять' }).click();
  await expect(dialog).toBeHidden();
});

async function canvasPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = page.locator('.board.selected > canvas').first();
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('The active drawing canvas has no visible bounds.');
  const dimensions = await canvas.evaluate((element) => ({
    width: (element as HTMLCanvasElement).width,
    height: (element as HTMLCanvasElement).height,
  }));
  return {
    x: bounds.x + ((x + 0.5) * bounds.width) / dimensions.width,
    y: bounds.y + ((y + 0.5) * bounds.height) / dimensions.height,
  };
}

async function pixel(page: Page, x: number, y: number): Promise<[number, number, number, number]> {
  return page.locator('.board.selected > canvas').first().evaluate(
    (element, point) => Array.from(
      (element as HTMLCanvasElement).getContext('2d')!.getImageData(point.x, point.y, 1, 1).data,
    ) as [number, number, number, number],
    { x, y },
  );
}

async function draw(page: Page, x0: number, y0: number, x1 = x0, y1 = y0): Promise<void> {
  const from = await canvasPoint(page, x0, y0);
  const to = await canvasPoint(page, x1, y1);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();
}

async function selectMenuItem(page: Page, menu: string, item: string): Promise<void> {
  await page.locator(`button[data-menu="${menu}"]`).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

async function savedFiles(page: Page): Promise<SavedFile[]> {
  return page.evaluate(() =>
    (window as Window & { __pixelEditorSavedFiles: SavedFile[] }).__pixelEditorSavedFiles,
  );
}

test('creates a second artboard and a layer through the editor controls', async ({ page }) => {
  await openEditor(page);

  await page.getByRole('button', { name: 'Добавить холст' }).click();
  await expect(page.locator('.board')).toHaveCount(2);

  await page.getByRole('button', { name: 'Layers' }).click();
  await page.locator('.layers-panel > summary').click();
  await page.getByRole('button', { name: 'Добавить слой' }).click();
  await expect(page.locator('.layers-panel > summary')).toContainText('Слои (2)');
});

test('draws exact pixels, then undoes and redoes the raster stroke', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: /Карандаш/ }).click();
  await draw(page, 2, 4, 8, 4);

  await expect.poll(async () => (await pixel(page, 5, 4))[3]).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect.poll(async () => (await pixel(page, 5, 4))[3]).toBe(0);
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect.poll(async () => (await pixel(page, 5, 4))[3]).toBeGreaterThan(0);
});

test('flood-fills the canvas and records one undoable operation', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: /Заливка/ }).click();
  const point = await canvasPoint(page, 8, 8);
  await page.mouse.click(point.x, point.y);

  await expect.poll(async () => (await pixel(page, 8, 8))[3]).toBe(255);
  const alphaValues = await page.locator('.board.selected > canvas').first().evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    for (let offset = 3; offset < data.length; offset += 4) if (data[offset] > 0) opaque++;
    return { opaque, total: canvas.width * canvas.height };
  });
  expect(alphaValues.opaque).toBe(alphaValues.total);

  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect.poll(async () => (await pixel(page, 8, 8))[3]).toBe(0);
});

test('restricts painting to a rectangular selection and moves the selected pixel without filtering', async ({ page }) => {
  await openEditor(page);
  await selectMenuItem(page, 'Правка', 'Выделение: прямоугольник');
  await draw(page, 4, 4, 6, 6);
  await selectMenuItem(page, 'Правка', 'Снять режим выделения');
  await page.getByRole('button', { name: /Карандаш/ }).click();
  await draw(page, 5, 5);
  await expect.poll(async () => (await pixel(page, 5, 5))[3]).toBeGreaterThan(0);
  const selectedColor = await pixel(page, 5, 5);

  await selectMenuItem(page, 'Правка', 'Сдвинуть вправо');
  await expect.poll(async () => (await pixel(page, 5, 5))[3]).toBe(0);
  await expect.poll(async () => (await pixel(page, 6, 5))[3]).toBeGreaterThan(0);
  expect(await pixel(page, 6, 5)).toEqual(selectedColor);
});

test('keeps animation frames independent when switching and drawing', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('combobox', { name: 'Рабочее пространство' }).selectOption('animation');
  const timeline = page.getByRole('region', { name: 'Timeline кадров' });
  await expect(timeline).toBeVisible();

  await page.getByRole('button', { name: /Карандаш/ }).click();
  await draw(page, 4, 4);
  await page.getByRole('button', { name: 'Добавить кадр' }).click();
  await expect(timeline.getByRole('button', { name: 'Кадр 2, 100 мс' })).toBeVisible();
  await expect.poll(async () => (await pixel(page, 4, 4))[3]).toBe(0);

  await draw(page, 8, 4);
  await timeline.getByRole('button', { name: 'Кадр 1, 100 мс' }).click();
  await expect.poll(async () => (await pixel(page, 4, 4))[3]).toBeGreaterThan(0);
  expect((await pixel(page, 8, 4))[3]).toBe(0);

  await timeline.getByRole('button', { name: 'Кадр 2, 100 мс' }).click();
  await expect.poll(async () => (await pixel(page, 8, 4))[3]).toBeGreaterThan(0);
  expect((await pixel(page, 4, 4))[3]).toBe(0);
});

test('exports a valid-sized PNG through the desktop save bridge', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: /Карандаш/ }).click();
  await draw(page, 4, 4);

  await page.getByRole('button', { name: 'Действия с файлом' }).click();
  await page.getByRole('button', { name: /Экспорт/ }).click();
  await expect.poll(async () => (await savedFiles(page)).length).toBe(1);

  const [file] = await savedFiles(page);
  expect(file?.suggestedName).toMatch(/\.png$/i);
  expect(file?.mimeType).toBe('image/png');
  expect(file?.size).toBeGreaterThan(8);
  expect(file?.signature).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(file?.width).toBe(128);
  expect(file?.height).toBe(128);
});
