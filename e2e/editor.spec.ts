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
  await page.locator('header input[type="file"]').setInputFiles({
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
  const importedPixel = await page.locator('.board > canvas:not(.selection-overlay):not(.transform-preview)').evaluate((canvas: HTMLCanvasElement) => {
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

test('creates independent raster layers, composites visibility, undoes changes, and restores the v5 autosave', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Вписать F' }).click();
  await page.locator('.layers-panel > summary').click();
  await page.getByRole('button', { name: 'Добавить слой' }).click();
  await expect(page.locator('.layer-list li')).toHaveCount(2);

  const canvas = page.locator('.board > canvas:not(.selection-overlay):not(.transform-preview)');
  await canvas.scrollIntoViewIfNeeded();
  const clickPixel = async (x: number, y: number) => {
    const point = await canvas.evaluate((element: HTMLCanvasElement, pixel: { x: number; y: number }) => {
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.left + ((pixel.x + 0.5) / element.width) * bounds.width,
        y: bounds.top + ((pixel.y + 0.5) / element.height) * bounds.height,
      };
    }, { x, y });
    await page.mouse.click(point.x, point.y);
  };
  const alphaAt = (x: number, y: number) => canvas.evaluate(
    (element: HTMLCanvasElement, pixel: { x: number; y: number }) =>
      element.getContext('2d')!.getImageData(pixel.x, pixel.y, 1, 1).data[3],
    { x, y },
  );

  await clickPixel(8, 8);
  await expect.poll(() =>
    page.locator('.layer-list li.active canvas.thumbnail').evaluate(
      (thumbnail: HTMLCanvasElement) => thumbnail.getContext('2d')!.getImageData(8, 8, 1, 1).data[3],
    ),
  ).toBe(255);
  await page.getByRole('button', { name: 'Слой 1', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  await clickPixel(12, 12);
  await expect.poll(() => alphaAt(8, 8)).toBe(255);
  await expect.poll(() => alphaAt(12, 12)).toBe(255);

  await page.getByRole('button', { name: 'Скрыть Слой 2' }).click();
  await expect.poll(() => alphaAt(8, 8)).toBe(0);
  await expect.poll(() => alphaAt(12, 12)).toBe(255);
  await page.keyboard.press('Control+z');
  await expect.poll(() => alphaAt(8, 8)).toBe(255);

  await page.evaluate(() => {
    window.pixelEditorDesktop = {
      saveFile: async ({ data }) => {
        let binary = '';
        for (let offset = 0; offset < data.length; offset += 0x8000) {
          binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
        }
        localStorage.setItem('layer-export', btoa(binary));
        return 'saved';
      },
    };
  });
  await page.getByRole('button', { name: 'Действия с файлом' }).click();
  await page.getByRole('group', { name: 'Масштаб экспорта' }).getByRole('button', { name: '×1', exact: true }).click();
  await page.getByRole('button', { name: /Экспорт 32×32/ }).click();
  await expect(page.locator('.toast')).toContainText('PNG сохранён: 32×32');
  const exportedAlphas = await page.evaluate(async () => {
    const bytes = Uint8Array.from(atob(localStorage.getItem('layer-export')!), (value) => value.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    return [context.getImageData(8, 8, 1, 1).data[3], context.getImageData(12, 12, 1, 1).data[3]];
  });
  expect(exportedAlphas).toEqual([255, 255]);

  await expect(page.locator('.statusbar .save')).toContainText('сохранено в', { timeout: 10_000 });
  await page.reload();
  await page.getByRole('button', { name: 'Вписать F' }).click();
  await page.locator('.layers-panel > summary').click();
  await expect(page.locator('.layer-list li')).toHaveCount(2);
  await expect.poll(() => alphaAt(8, 8)).toBe(255);
  await expect.poll(() => alphaAt(12, 12)).toBe(255);
  await expect(page.getByRole('button', { name: 'Скрыть Слой 2' })).toHaveAttribute('aria-pressed', 'true');
});

test('supports nested groups and roles, persists them, and excludes reference pixels from export', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Вписать F' }).click();
  await page.locator('.layers-panel > summary').click();
  const canvas = page.locator('.board > canvas:not(.selection-overlay):not(.transform-preview)');
  await canvas.scrollIntoViewIfNeeded();
  const clickPixel = async (x: number, y: number) => {
    const point = await canvas.evaluate((element: HTMLCanvasElement, pixel: { x: number; y: number }) => {
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.left + ((pixel.x + 0.5) / element.width) * bounds.width,
        y: bounds.top + ((pixel.y + 0.5) / element.height) * bounds.height,
      };
    }, { x, y });
    await page.mouse.click(point.x, point.y);
  };
  const readPixel = (x: number, y: number) => canvas.evaluate(
    (element: HTMLCanvasElement, pixel: { x: number; y: number }) =>
      Array.from(element.getContext('2d')!.getImageData(pixel.x, pixel.y, 1, 1).data),
    { x, y },
  );
  const activeLayerAlphaAt = (x: number, y: number) => page.locator('.layer-list li.active canvas.thumbnail').evaluate(
    (thumbnail: HTMLCanvasElement, pixel: { x: number; y: number }) =>
      thumbnail.getContext('2d')!.getImageData(pixel.x, pixel.y, 1, 1).data[3],
    { x, y },
  );

  await clickPixel(8, 8);
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await page.getByRole('button', { name: 'Заблокировать группу Группа 1' }).click();
  await clickPixel(9, 9);
  await expect.poll(() => activeLayerAlphaAt(9, 9)).toBe(0);
  await page.getByRole('button', { name: 'Разблокировать группу Группа 1' }).click();
  await page.getByRole('button', { name: 'Создать референс' }).click();
  await page.getByLabel('Группа активного слоя').selectOption({ label: 'Группа 1' });
  await page.getByRole('button', { name: 'Создать группу' }).click();
  await expect(page.getByRole('list', { name: 'Группы слоёв' }).locator('li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Добавить фон' }).click();
  await expect(page.getByRole('button', { name: 'Скрыть Фон' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Скрыть Слой 1' }).click();
  await expect.poll(() => readPixel(8, 8)).not.toEqual([255, 255, 255, 255]);
  const fullOpacityPixel = await readPixel(8, 8);
  await page.getByLabel('Параметры группы Группа 1').click();
  const groupOpacity = page.getByLabel('Непрозрачность группы Группа 1');
  await groupOpacity.evaluate((input: HTMLInputElement) => {
    input.value = '50';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => readPixel(8, 8)).not.toEqual(fullOpacityPixel);
  await groupOpacity.evaluate((input: HTMLInputElement) => {
    input.value = '100';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await page.evaluate(() => {
    window.pixelEditorDesktop = {
      saveFile: async ({ data }) => {
        let binary = '';
        for (let offset = 0; offset < data.length; offset += 0x8000) {
          binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
        }
        localStorage.setItem('role-export', btoa(binary));
        return 'saved';
      },
    };
  });
  await page.getByRole('button', { name: 'Действия с файлом' }).click();
  await page.getByRole('group', { name: 'Масштаб экспорта' }).getByRole('button', { name: '×1', exact: true }).click();
  await page.getByRole('button', { name: /Экспорт 32×32/ }).click();
  await expect(page.locator('.toast')).toContainText('PNG сохранён: 32×32');
  const exportedPixel = await page.evaluate(async () => {
    const bytes = Uint8Array.from(atob(localStorage.getItem('role-export')!), (value) => value.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    return Array.from(context.getImageData(8, 8, 1, 1).data);
  });
  expect(exportedPixel).toEqual([255, 255, 255, 255]);

  await expect(page.locator('.statusbar .save')).toContainText('сохранено в', { timeout: 10_000 });
  await page.reload();
  await page.locator('.layers-panel > summary').click();
  await expect(page.getByRole('list', { name: 'Группы слоёв' }).locator('li')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Скрыть Фон' })).toHaveAttribute('aria-pressed', 'true');
});

test('samples visible layers for bucket-fill without modifying the source layer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Вписать F' }).click();
  await page.locator('.layers-panel > summary').click();
  const canvas = page.locator('.board > canvas:not(.selection-overlay):not(.transform-preview)');
  await canvas.scrollIntoViewIfNeeded();
  const clickPixel = async (x: number, y: number) => {
    const point = await canvas.evaluate((element: HTMLCanvasElement, pixel: { x: number; y: number }) => {
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.left + ((pixel.x + 0.5) / element.width) * bounds.width,
        y: bounds.top + ((pixel.y + 0.5) / element.height) * bounds.height,
      };
    }, { x, y });
    await page.mouse.click(point.x, point.y);
  };
  const alphaAt = (x: number, y: number) => canvas.evaluate(
    (element: HTMLCanvasElement, pixel: { x: number; y: number }) =>
      element.getContext('2d')!.getImageData(pixel.x, pixel.y, 1, 1).data[3],
    { x, y },
  );

  await clickPixel(8, 8);
  await page.getByRole('button', { name: 'Добавить слой' }).click();
  await page.locator('.layers-panel > summary').click();
  await canvas.scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Заливка (B)' }).click();
  await page.locator('summary[aria-label="Параметры инструмента"]').click();
  await page.getByRole('checkbox', { name: 'Выбирать цвет по видимым слоям' }).check();
  await canvas.scrollIntoViewIfNeeded();
  await clickPixel(8, 8);
  await page.locator('.layers-panel > summary').click();
  await page.getByRole('button', { name: 'Скрыть Слой 1' }).click();
  await expect.poll(() => alphaAt(8, 8)).toBe(255);
  await expect.poll(() => alphaAt(20, 20)).toBe(0);
});

test('creates a new layer from the merged visible pixels inside a selection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Вписать F' }).click();
  await page.locator('.layers-panel > summary').click();
  const canvas = page.locator('.board > canvas:not(.selection-overlay):not(.transform-preview)');
  await canvas.scrollIntoViewIfNeeded();
  const clickPixel = async (x: number, y: number) => {
    const point = await canvas.evaluate((element: HTMLCanvasElement, pixel: { x: number; y: number }) => {
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.left + ((pixel.x + 0.5) / element.width) * bounds.width,
        y: bounds.top + ((pixel.y + 0.5) / element.height) * bounds.height,
      };
    }, { x, y });
    await page.mouse.click(point.x, point.y);
  };
  const alphaAt = (x: number, y: number) => canvas.evaluate(
    (element: HTMLCanvasElement, pixel: { x: number; y: number }) =>
      element.getContext('2d')!.getImageData(pixel.x, pixel.y, 1, 1).data[3],
    { x, y },
  );

  await clickPixel(8, 8);
  await page.locator('.layers-panel > summary').click();
  await page.getByText('Выделение', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Выделять и копировать по видимым слоям' }).check();
  await page.getByRole('button', { name: 'Непрозрачные пиксели' }).click();
  await page.getByText('Выделение', { exact: true }).click();
  await page.locator('.layers-panel > summary').click();
  await page.getByRole('button', { name: 'Создать слой из выделения' }).click();
  await page.getByRole('button', { name: 'Скрыть Слой 1' }).click();
  await expect(page.locator('.layer-list li')).toHaveCount(2);
  await expect.poll(() => alphaAt(8, 8)).toBe(255);
  await expect.poll(() => alphaAt(20, 20)).toBe(0);
});

test('supports the 1–64 brush range, round tips, opacity, and rendered pixel preview', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Вписать F' }).click();

  const sizeSlider = page.getByRole('slider', { name: 'Размер кисти' });
  await sizeSlider.fill('4');
  await expect(sizeSlider).toHaveAttribute('aria-valuetext', '4 пикселей');
  await page.getByRole('button', { name: 'Круглая кисть' }).click();
  await expect(page.getByRole('button', { name: 'Круглая кисть' })).toHaveAttribute('aria-pressed', 'true');

  const opacitySlider = page.getByRole('slider', { name: 'Непрозрачность кисти' });
  await opacitySlider.fill('50');
  await expect(opacitySlider).toHaveAttribute('aria-valuetext', '50%');

  const canvas = page.locator('.board > canvas:not(.selection-overlay):not(.transform-preview)');
  await canvas.scrollIntoViewIfNeeded();
  const pixel = await canvas.evaluate((element: HTMLCanvasElement) => {
    const bounds = element.getBoundingClientRect();
    const x = 16;
    const y = 16;
    const clientX = bounds.left + ((x + 0.5) / element.width) * bounds.width;
    const clientY = bounds.top + ((y + 0.5) / element.height) * bounds.height;
    return { clientX, clientY };
  });
  await page.mouse.click(pixel.clientX, pixel.clientY);
  await expect.poll(() =>
    canvas.evaluate((element: HTMLCanvasElement) => element.getContext('2d')!.getImageData(16, 16, 1, 1).data[3]),
  ).toBe(128);
  await page.keyboard.press('Control+z');
  await expect.poll(() =>
    canvas.evaluate((element: HTMLCanvasElement) => element.getContext('2d')!.getImageData(16, 16, 1, 1).data[3]),
  ).toBe(0);
  await page.keyboard.press('Control+y');
  await expect.poll(() =>
    canvas.evaluate((element: HTMLCanvasElement) => element.getContext('2d')!.getImageData(16, 16, 1, 1).data[3]),
  ).toBe(128);
});

test('previews pixel transforms before confirmation and records one undo step', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Вписать F' }).click();
  const canvas = page.locator('.board > canvas:not(.selection-overlay):not(.transform-preview)');
  const pixel = await canvas.evaluate((element: HTMLCanvasElement) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.left + (10.5 / element.width) * bounds.width,
      y: bounds.top + (10.5 / element.height) * bounds.height,
    };
  });
  await page.mouse.click(pixel.x, pixel.y);
  await page.getByText('Выделение', { exact: true }).click();
  await page.getByRole('button', { name: 'Прямоугольное' }).click();
  await page.mouse.move(pixel.x, pixel.y);
  await page.mouse.down();
  await page.mouse.up();

  await page.getByRole('button', { name: 'Масштаб ×2' }).click();
  await expect(page.getByText('Предпросмотр трансформации')).toBeVisible();
  const previewAlpha = await page.locator('.transform-preview').evaluate((element: HTMLCanvasElement) =>
    element.getContext('2d')!.getImageData(11, 11, 1, 1).data[3],
  );
  const originalAlpha = await canvas.evaluate((element: HTMLCanvasElement) =>
    element.getContext('2d')!.getImageData(11, 11, 1, 1).data[3],
  );
  expect(previewAlpha).toBe(255);
  expect(originalAlpha).toBe(0);

  await page.getByRole('application').getByRole('button', { name: 'Применить' }).click();
  await expect.poll(() =>
    canvas.evaluate((element: HTMLCanvasElement) => element.getContext('2d')!.getImageData(11, 11, 1, 1).data[3]),
  ).toBe(255);
  await page.keyboard.press('Control+z');
  await expect.poll(() =>
    canvas.evaluate((element: HTMLCanvasElement) => element.getContext('2d')!.getImageData(11, 11, 1, 1).data[3]),
  ).toBe(0);
});

test('exposes drawing settings, validates custom dithering, and persists the brush library', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Градиент (V)' }).click();
  await page.locator('summary[aria-label="Параметры инструмента"]').click();
  await expect(page.getByRole('combobox', { name: 'Тип градиента' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Переход в прозрачность' }).check();
  await page.getByRole('checkbox', { name: 'Средняя точка' }).check();
  await expect(page.getByRole('slider', { name: 'Позиция средней точки градиента' })).toBeVisible();
  await page.getByText('Форматы цвета', { exact: true }).click();
  await expect(page.getByText(/HSV/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Дизеринг (D)' }).click();
  await page.getByRole('combobox', { name: 'Паттерн дизеринга' }).selectOption('custom');
  const customPattern = page.getByRole('textbox', { name: 'Маска пользовательского дизеринга' });
  await customPattern.fill('1/22');
  await expect.poll(() => customPattern.evaluate((element: HTMLInputElement) => element.validationMessage)).not.toBe('');
  await customPattern.fill('01/10');
  await expect.poll(() => customPattern.evaluate((element: HTMLInputElement) => element.validationMessage)).toBe('');

  await page.getByRole('button', { name: 'Карандаш (P)' }).click();
  await page.getByRole('slider', { name: 'Размер кисти' }).fill('4');
  await page.getByRole('button', { name: 'Круглая кисть' }).click();
  await page.getByText('Кисти', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Имя кисти' }).fill('Browser Brush');
  await page.getByRole('combobox', { name: 'Тип кисти' }).selectOption('circle');
  await page.getByRole('button', { name: 'Сохранить текущую кисть' }).click();
  await expect(page.getByRole('combobox', { name: 'Библиотека кистей' })).toContainText('Browser Brush');
  await expect(page.getByText('Маска: 12/16 пикселей')).toBeVisible();
  const maskEditor = page.getByRole('button', { name: /Редактор маски кисти/ });
  await maskEditor.scrollIntoViewIfNeeded();
  const maskBounds = await maskEditor.boundingBox();
  if (!maskBounds) throw new Error('Редактор маски кисти не имеет доступной области.');
  await page.mouse.click(maskBounds.x + 2, maskBounds.y + 2);
  await expect(page.getByText('Маска: 13/16 пикселей')).toBeVisible();
  await page.reload();
  await page.getByText('Кисти', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Библиотека кистей' })).toContainText('Browser Brush');
  await page.getByRole('combobox', { name: 'Библиотека кистей' }).selectOption({ label: 'Browser Brush · circle · 4px' });
  await expect(page.getByText('Маска: 13/16 пикселей')).toBeVisible();
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
