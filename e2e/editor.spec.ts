import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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

test('groups shape tools in a five-column popout', async ({ page }) => {
  await page.goto('/');

  const shapeFolder = page.getByRole('button', { name: 'Фигуры' });
  await expect(shapeFolder).toHaveAttribute('aria-expanded', 'false');
  await shapeFolder.click();

  const shapePanel = page.getByRole('group', { name: 'Фигуры' });
  await expect(shapePanel.locator('button')).toHaveCount(11);
  const columnCount = await shapePanel.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length,
  );
  expect(columnCount).toBe(5);

  await page.getByRole('button', { name: 'Эллипс (O)' }).click();
  await expect(shapeFolder).toHaveAttribute('aria-expanded', 'false');
  await expect(shapeFolder).toHaveClass(/active/);
});

test('pans the workspace from empty space and scrolls the vertical tool panel', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 520 });
  await page.goto('/');

  const toolPanel = page.getByRole('complementary', { name: 'Инструменты' });
  const desktopOverflow = await toolPanel.evaluate((element) => {
    const style = getComputedStyle(element);
    return { x: style.overflowX, y: style.overflowY };
  });
  expect(desktopOverflow).toEqual({ x: 'hidden', y: 'auto' });

  await expect.poll(() => toolPanel.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await toolPanel.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => toolPanel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.setViewportSize({ width: 800, height: 600 });
  const mobileOverflow = await toolPanel.evaluate((element) => {
    const style = getComputedStyle(element);
    return { x: style.overflowX, y: style.overflowY };
  });
  expect(mobileOverflow).toEqual({ x: 'auto', y: 'hidden' });
  await expect.poll(() => toolPanel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Увеличить' }).click();
  await page.getByRole('button', { name: 'Увеличить' }).click();
  await page.getByRole('button', { name: 'Увеличить' }).click();
  const viewport = page.locator('.viewport');
  const emptyPoint = await viewport.evaluate((element) => {
    const viewportBounds = element.getBoundingClientRect();
    const boardBounds = element.querySelector<HTMLElement>('.board')!.getBoundingClientRect();
    const point = { x: viewportBounds.right - 24, y: viewportBounds.bottom - 24 };
    if (point.x >= boardBounds.left && point.x <= boardBounds.right &&
      point.y >= boardBounds.top && point.y <= boardBounds.bottom) {
      throw new Error('Не удалось найти свободное место рядом с холстом.');
    }
    return point;
  });
  const stage = page.locator('.stage');
  const before = await stage.getAttribute('style');
  await page.mouse.move(emptyPoint.x, emptyPoint.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(emptyPoint.x - 60, emptyPoint.y - 40);
  await page.mouse.up({ button: 'right' });
  await expect.poll(() => stage.getAttribute('style')).not.toBe(before);
});

test('moves a single board independently and moves a Ctrl+right-click selection as a group', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Добавить холст' }).click();
  await page.getByRole('button', { name: 'Центр', exact: true }).click();
  for (let step = 0; step < 4; step++) {
    await page.getByRole('button', { name: 'Уменьшить' }).click();
  }
  const boards = page.locator('.board');
  await expect(boards).toHaveCount(2);

  const position = (index: number) => boards.nth(index).evaluate((element) => ({
    left: Number.parseFloat((element as HTMLElement).style.left),
    top: Number.parseFloat((element as HTMLElement).style.top),
  }));
  const center = (index: number) => boards.nth(index).evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const viewport = element.closest('.stage')!.parentElement!.getBoundingClientRect();
    const left = Math.max(bounds.left, viewport.left);
    const right = Math.min(bounds.right, viewport.right);
    const top = Math.max(bounds.top, viewport.top);
    const bottom = Math.min(bounds.bottom, viewport.bottom);
    if (left >= right || top >= bottom) throw new Error('Холст не виден в рабочей области.');
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  });
  const initial = [await position(0), await position(1)];
  const singleStart = await center(1);
  await page.keyboard.down('Control');
  await page.mouse.move(singleStart.x, singleStart.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(singleStart.x + 45, singleStart.y + 35);
  await page.mouse.up({ button: 'right' });
  await page.keyboard.up('Control');

  const singleMoved = [await position(0), await position(1)];
  expect(singleMoved[0]).toEqual(initial[0]);
  expect(singleMoved[1]).not.toEqual(initial[1]);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => [await position(0), await position(1)]).toEqual(initial);

  const firstCenter = await center(0);
  await page.keyboard.down('Control');
  await page.mouse.click(firstCenter.x, firstCenter.y, { button: 'right' });
  await page.keyboard.up('Control');
  await expect(boards.nth(1)).toHaveClass(/group-selected/);

  const groupStart = await center(0);
  await page.keyboard.down('Control');
  await page.mouse.move(groupStart.x, groupStart.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(groupStart.x + 45, groupStart.y + 35);
  await page.mouse.up({ button: 'right' });
  await page.keyboard.up('Control');

  const groupMoved = [await position(0), await position(1)];
  expect(groupMoved[0]).not.toEqual(initial[0]);
  expect(groupMoved[1]).not.toEqual(initial[1]);
  expect(groupMoved[0]!.left - initial[0]!.left).toBe(groupMoved[1]!.left - initial[1]!.left);
  expect(groupMoved[0]!.top - initial[0]!.top).toBe(groupMoved[1]!.top - initial[1]!.top);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => [await position(0), await position(1)]).toEqual(initial);

  const emptyPoint = await page.locator('.viewport').evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const boardBounds = [...element.querySelectorAll<HTMLElement>('.board')]
      .map((board) => board.getBoundingClientRect());
    for (let y = bounds.top + 8; y < bounds.bottom - 8; y += 16) {
      for (let x = bounds.left + 8; x < bounds.right - 8; x += 16) {
        if (boardBounds.every((board) => x < board.left || x > board.right || y < board.top || y > board.bottom)) {
          return { x, y };
        }
      }
    }
    throw new Error('Не удалось найти пустое место в рабочей области.');
  });
  await page.mouse.click(emptyPoint.x, emptyPoint.y);
  await expect(boards.nth(1)).not.toHaveClass(/group-selected/);
});

test('creates and edits a tileset-backed tilemap, then restores it from autosave', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Tilemap' }).click();
  await page.getByRole('button', { name: 'Создать tileset из активного холста' }).click();
  await expect(page.getByRole('heading', { name: 'Tileset (4)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать Tile 1' })).toBeVisible();

  const firstTileCanvas = page.locator('.tile-list button').first().locator('canvas');
  const readEditedPixels = () => firstTileCanvas.evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')!;
    return [3, 4].map((x) => [...context.getImageData(x, 3, 1, 1).data]);
  });
  const originalPixels = await readEditedPixels();
  const tileEditor = page.getByLabel('Редактор пикселей выбранного тайла');
  await tileEditor.scrollIntoViewIfNeeded();
  const tileEditorBounds = await tileEditor.boundingBox();
  if (!tileEditorBounds) throw new Error('Редактор пикселей тайла не отображается.');
  const editorPixel = (column: number) => ({
    x: tileEditorBounds.x + tileEditorBounds.width * (column + 0.5) / 16,
    y: tileEditorBounds.y + tileEditorBounds.height * 3.5 / 16,
  });
  const strokeStart = editorPixel(3);
  await page.mouse.move(strokeStart.x, strokeStart.y);
  await page.mouse.down();
  const strokeEnd = editorPixel(4);
  await page.mouse.move(strokeEnd.x, strokeEnd.y);
  await page.mouse.up();
  await expect.poll(readEditedPixels).not.toEqual(originalPixels);
  const editedPixels = await readEditedPixels();
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect.poll(readEditedPixels).toEqual(originalPixels);
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect.poll(readEditedPixels).toEqual(editedPixels);

  const atlasDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт PNG tileset' }).click();
  const atlasDownload = await atlasDownloadPromise;
  expect(atlasDownload.suggestedFilename()).toBe('tileset.png');
  const png = await readFile(await atlasDownload.path());
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.readUInt32BE(16)).toBe(64);
  expect(png.readUInt32BE(20)).toBe(16);

  const variantGroup = page.getByLabel('Группа вариантов');
  await variantGroup.fill('ground');
  await variantGroup.evaluate((element: HTMLInputElement) => element.blur());
  await expect(variantGroup).toHaveValue('ground');
  await page.getByRole('button', { name: 'Добавить слой' }).click();
  await expect(page.locator('.map-layer')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Сетка' }).selectOption('hexagonal');
  await page.getByRole('button', { name: 'Бесшовное превью' }).click();
  await expect(page.locator('canvas[aria-label="Плиточный предпросмотр выбранного тайла"]')).toBeVisible();

  await page.getByRole('button', { name: 'Заливка прямоугольника' }).click();
  const mapCanvas = page.locator('canvas[aria-label^="Карта тайлов"]');
  const bounds = await mapCanvas.boundingBox();
  if (!bounds) throw new Error('Карта тайлов не отображается.');
  await page.mouse.move(bounds.x + 16, bounds.y + 6);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 48, bounds.y + 18);
  await page.mouse.up();

  const exportMetadata = async () => {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Экспорт метаданных' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('tilemap.json');
    return JSON.parse(await readFile(await download.path(), 'utf8')) as {
      grid: string;
      layers: Array<{ cells: Array<string | null> }>;
    };
  };
  const metadata = await exportMetadata();
  expect(metadata.grid).toBe('hexagonal');
  expect(metadata.layers).toHaveLength(2);
  expect(metadata.layers[1]!.cells.some((tileId) => tileId !== null)).toBe(true);

  await page.getByRole('button', { name: 'Отменить' }).click();
  const undoneMetadata = await exportMetadata();
  expect(undoneMetadata.layers[1]!.cells.every((tileId) => tileId === null)).toBe(true);
  await page.getByRole('button', { name: 'Повторить' }).click();

  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Tilemap' }).click();
  await expect(page.getByRole('heading', { name: 'Tileset (4)' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Сетка' })).toHaveValue('hexagonal');
  await expect.poll(readEditedPixels).toEqual(editedPixels);
  const restoredMetadata = await exportMetadata();
  expect(restoredMetadata.layers[1]!.cells.some((tileId) => tileId !== null)).toBe(true);
});

test('switches, resizes, hides, and restores saved workspace layouts', async ({ page }) => {
  await page.goto('/');
  const workspace = page.getByRole('combobox', { name: 'Рабочее пространство' });
  const toolsDock = page.locator('.tool-dock');
  const paletteDock = page.locator('.palette-dock');

  await workspace.selectOption('minimal');
  await expect(toolsDock).toHaveCount(0);
  await expect(paletteDock).toHaveCount(0);
  await page.getByRole('button', { name: 'Палитра' }).click();
  await expect(paletteDock).toBeVisible();
  await page.getByRole('button', { name: 'Палитра' }).click();
  await expect(paletteDock).toHaveCount(0);

  await workspace.selectOption('drawing');
  await expect(toolsDock).toBeVisible();
  await expect(paletteDock).toBeVisible();
  const toolSplitter = page.getByRole('slider', { name: 'Изменить ширину панели инструментов' });
  const previousWidth = Number(await toolSplitter.getAttribute('aria-valuenow'));
  await toolSplitter.focus();
  await page.keyboard.press('ArrowRight');
  await expect(toolSplitter).toHaveAttribute('aria-valuenow', String(previousWidth + 8));

  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('combobox', { name: 'Рабочее пространство' })).toHaveValue('drawing');
  await expect(page.getByRole('slider', { name: 'Изменить ширину панели инструментов' }))
    .toHaveAttribute('aria-valuenow', String(previousWidth + 8));

  await page.getByRole('combobox', { name: 'Рабочее пространство' }).selectOption('tileset');
  await expect(page.getByRole('heading', { name: 'Редактор Tilemap' })).toBeVisible();
  await expect(toolsDock).toHaveCount(0);
  await expect(paletteDock).toHaveCount(0);
});

test('uses top-level menus, dock panels, and editable animation frames', async ({ page }) => {
  await page.goto('/');
  const fileMenu = page.getByRole('button', { name: 'Файл', exact: true });
  await fileMenu.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Открыть…' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(fileMenu).toBeFocused();

  const workspace = page.getByRole('combobox', { name: 'Рабочее пространство' });
  await expect(workspace).toBeVisible();
  await workspace.selectOption('animation');
  await expect(page.getByRole('region', { name: 'Timeline кадров' })).toBeVisible();
  const timelineSplitter = page.getByRole('slider', { name: 'Изменить высоту Timeline' });
  const initialTimelineHeight = Number(await timelineSplitter.getAttribute('aria-valuenow'));
  await timelineSplitter.focus();
  await page.keyboard.press('ArrowUp');
  await expect(timelineSplitter).toHaveAttribute('aria-valuenow', String(initialTimelineHeight + 8));

  await page.getByRole('button', { name: 'Добавить кадр' }).click();
  await expect(page.getByText('2 кадров')).toBeVisible();
  await page.getByRole('button', { name: 'Дублировать кадр' }).click();
  await expect(page.getByText('3 кадров')).toBeVisible();
  const duration = page.getByRole('spinbutton', { name: 'Длительность кадра (мс)' });
  await duration.fill('250');
  await duration.press('Enter');
  await expect(page.getByRole('button', { name: 'Кадр 3, 250 мс' })).toBeVisible();

  await page.getByRole('button', { name: 'Properties' }).click();
  await expect(page.getByText('Кадр: 3 / 3')).toBeVisible();
  await page.getByRole('button', { name: 'Кадр 1, 100 мс' }).click();
  await expect(page.getByText('Кадр: 1 / 3')).toBeVisible();

  await page.getByRole('button', { name: 'Окно', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Панель: History' }).click();
  await expect(page.getByRole('heading', { name: 'История' })).toBeVisible();

  await page.waitForTimeout(1100);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'History' })).toHaveAttribute('aria-pressed', 'true');
});

test('smoothly minifies canvas artwork below 100% and keeps pixelated rendering when enlarged', async ({ page }) => {
  await page.goto('/');
  const zoomOut = page.getByRole('button', { name: 'Уменьшить' });
  const zoomIn = page.getByRole('button', { name: 'Увеличить' });
  const canvas = page.locator('.board > canvas:not(.selection-overlay):not(.transform-preview)');

  for (let step = 0; step < 20; step++) {
    const zoom = await canvas.evaluate((element: HTMLCanvasElement) =>
      element.getBoundingClientRect().width / element.width,
    );
    if (zoom < 1) break;
    await zoomOut.click();
  }

  await expect(page.locator('.board')).toHaveClass(/zoomed-out/);
  await expect.poll(() => canvas.evaluate((element) => getComputedStyle(element).imageRendering)).toBe('auto');
  await zoomIn.click();
  await expect(page.locator('.board')).not.toHaveClass(/zoomed-out/);
  await expect.poll(() => canvas.evaluate((element) => getComputedStyle(element).imageRendering)).toBe('pixelated');
});

test('applies non-destructive layer effects that can be toggled, removed, undone, and restored', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Вписать F' }).click();
  const canvas = page.locator('.board > canvas:not(.selection-overlay):not(.transform-preview)');
  const point = await canvas.evaluate((element: HTMLCanvasElement) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.left + (16.5 / element.width) * bounds.width,
      y: bounds.top + (16.5 / element.height) * bounds.height,
    };
  });
  await page.mouse.click(point.x, point.y);
  await page.locator('.layers-panel > summary').click();

  const addEffect = page.getByRole('combobox', { name: 'Добавить эффект' });
  await expect(addEffect.locator('option')).toHaveCount(14);
  await addEffect.selectOption('outline');
  const effectToggle = page.getByRole('checkbox', { name: 'Включить эффект Обводка' });
  const alphaAt = (x: number, y: number) => canvas.evaluate(
    (element: HTMLCanvasElement, pixel: { x: number; y: number }) =>
      element.getContext('2d')!.getImageData(pixel.x, pixel.y, 1, 1).data[3],
    { x, y },
  );
  await expect.poll(() => alphaAt(15, 16)).toBe(255);
  await effectToggle.uncheck();
  await expect.poll(() => alphaAt(15, 16)).toBe(0);
  await effectToggle.check();
  await page.getByRole('button', { name: 'Удалить эффект Обводка' }).click();
  await expect.poll(() => alphaAt(15, 16)).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(() => alphaAt(15, 16)).toBe(255);

  await page.waitForTimeout(900);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.layers-panel > summary').click();
  await expect(page.getByRole('button', { name: 'Удалить эффект Обводка' })).toBeVisible();
});

test('configures viewport grid and transparency, persists preferences, and uses actual-size zoom', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.board.checkerboard')).toHaveCount(1);
  await page.getByLabel('Тип сетки').selectOption('isometric');
  await page.getByLabel('Шаг сетки').selectOption('8');
  await expect(page.locator('.grid.isometric-grid')).toBeVisible();
  await page.locator('.view-settings > summary').click();
  await expect(page.getByRole('group', { name: 'Настройки отображения' }).locator('input[type="checkbox"]')).toHaveCount(5);
  await page.getByRole('checkbox', { name: 'Привязка' }).check();
  await page.getByRole('checkbox', { name: 'Шахматный фон' }).uncheck();
  await expect(page.locator('.board.checkerboard')).toHaveCount(0);

  await page.getByRole('button', { name: '100%' }).click();
  const scale = await page.locator('.board > canvas:not(.selection-overlay):not(.transform-preview)').evaluate(
    (canvas: HTMLCanvasElement) => canvas.getBoundingClientRect().width / canvas.width,
  );
  expect(scale).toBe(1);

  await page.reload();
  await expect(page.getByLabel('Тип сетки')).toHaveValue('isometric');
  await expect(page.getByLabel('Шаг сетки')).toHaveValue('8');
  await page.locator('.view-settings > summary').click();
  await expect(page.getByRole('checkbox', { name: 'Привязка' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Шахматный фон' })).not.toBeChecked();
  await expect(page.locator('.board.checkerboard')).toHaveCount(0);
});

test('removes guide buttons while keeping symmetry, tiled previews, and live preview available', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Напр. X+' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Напр. Y+' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Напр. очистить' })).toHaveCount(0);

  await page.locator('.view-settings > summary').click();
  await page.getByRole('checkbox', { name: 'Симметрия X' }).check();
  await page.getByRole('checkbox', { name: 'Симметрия Y' }).check();
  await expect(page.locator('.symmetry-guide')).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Повтор' }).check();
  await expect(page.locator('.tiled-background')).toBeVisible();

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Окно предпросмотра' }).click();
  const popup = await popupPromise;
  await expect(popup.locator('canvas')).toHaveJSProperty('width', 32);
  await expect(popup.locator('#size')).toHaveText('32×32');
  const boardCanvas = page.locator('.board > canvas:not(.selection-overlay):not(.transform-preview)');
  const drawPoint = await boardCanvas.evaluate((canvas: HTMLCanvasElement) => {
    const bounds = canvas.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  });
  await page.mouse.click(drawPoint.x, drawPoint.y);
  await expect.poll(() => popup.locator('canvas').evaluate((canvas: HTMLCanvasElement) =>
    canvas.getContext('2d')!.getImageData(16, 16, 1, 1).data[3],
  )).toBe(255);
  await popup.close();
});

test('imports, transforms, samples, and autosaves external references independently from canvas pixels', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Вписать F' }).click();
  await page.getByRole('button', { name: 'Референсы' }).click();
  const png = await createPng(page, 8, 8);
  await page.getByLabel('Импортировать изображение референса').setInputFiles({
    name: 'reference.png',
    mimeType: 'image/png',
    buffer: png,
  });
  const reference = page.locator('canvas.reference-image');
  await expect(reference).toHaveCount(1);
  const includeReferences = page.getByRole('checkbox', { name: 'Включать референсы в экспорт' });
  await expect(includeReferences).not.toBeChecked();
  await expect(includeReferences).toBeEnabled();
  await page.evaluate(() => {
    window.pixelEditorDesktop = {
      saveFile: async (request) => {
        let binary = '';
        for (let offset = 0; offset < request.data.length; offset += 0x8000) {
          binary += String.fromCharCode(...request.data.subarray(offset, offset + 0x8000));
        }
        localStorage.setItem('reference-export', btoa(binary));
        return 'saved';
      },
    };
  });
  await page.getByRole('button', { name: 'Действия с файлом' }).click();
  await page.getByRole('button', { name: /Экспорт 128×128/ }).click();
  await expect(page.locator('.toast')).toContainText('PNG сохранён');
  const defaultExportPixel = await page.evaluate(async () => {
    const bytes = Uint8Array.from(atob(localStorage.getItem('reference-export')!), (value) => value.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const pixel = Array.from(context.getImageData(65, 65, 1, 1).data);
    bitmap.close();
    return pixel;
  });
  expect(defaultExportPixel[3]).toBe(0);
  await includeReferences.check();
  await page.getByRole('button', { name: 'Действия с файлом' }).click();
  await page.getByRole('button', { name: /Экспорт 128×128/ }).click();
  await expect(page.locator('.toast')).toContainText('PNG сохранён');
  const optedInExportPixel = await page.evaluate(async () => {
    const bytes = Uint8Array.from(atob(localStorage.getItem('reference-export')!), (value) => value.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const pixel = Array.from(context.getImageData(65, 65, 1, 1).data);
    bitmap.close();
    return pixel;
  });
  expect(Math.abs(optedInExportPixel[0]! - 124)).toBeLessThanOrEqual(1);
  expect(Math.abs(optedInExportPixel[1]! - 92)).toBeLessThanOrEqual(1);
  expect(Math.abs(optedInExportPixel[2]! - 255)).toBeLessThanOrEqual(1);
  expect(optedInExportPixel[3]).toBe(153);
  const boardPixelBefore = await page.locator('.board canvas').first().evaluate((canvas: HTMLCanvasElement) =>
    Array.from(canvas.getContext('2d')!.getImageData(16, 16, 1, 1).data),
  );

  await page.getByRole('button', { name: 'Закрыть панель референсов' }).click();
  const beforeMove = parseFloat(await reference.evaluate((canvas) => getComputedStyle(canvas).left));
  const box = await reference.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 32, box!.y + box!.height / 2 + 16, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => parseFloat(await reference.evaluate((canvas) => getComputedStyle(canvas).left)))
    .toBeGreaterThan(beforeMove);
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect.poll(async () => parseFloat(await reference.evaluate((canvas) => getComputedStyle(canvas).left)))
    .toBe(beforeMove);
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect.poll(async () => parseFloat(await reference.evaluate((canvas) => getComputedStyle(canvas).left)))
    .toBeGreaterThan(beforeMove);

  await page.getByRole('button', { name: 'Референсы' }).click();
  const transformInputs = page.locator('.references-panel input[type="number"]');
  await transformInputs.nth(2).fill('2');
  await transformInputs.nth(3).fill('90');
  await page.getByRole('slider', { name: 'Непрозрачность референса' }).evaluate((input: HTMLInputElement) => {
    input.value = '25';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(reference).toHaveCSS('opacity', '0.25');
  await expect(reference).not.toHaveCSS('transform', 'none');

  await page.getByRole('button', { name: 'Заблокировать reference.png' }).click();
  await expect(page.getByRole('button', { name: 'Разблокировать reference.png' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Скрыть reference.png' }).click();
  await expect(reference).toHaveCount(0);
  await page.getByRole('button', { name: 'Показать reference.png' }).click();
  await expect(reference).toHaveCount(1);
  await page.getByRole('button', { name: 'Закрыть панель референсов' }).click();

  await page.getByRole('switch', { name: 'Свободный цвет' }).click();
  await page.getByRole('button', { name: 'Пипетка (I)' }).click();
  const sampleBox = await reference.boundingBox();
  expect(sampleBox).not.toBeNull();
  await page.mouse.click(sampleBox!.x + sampleBox!.width / 2, sampleBox!.y + sampleBox!.height / 2);
  await expect(page.locator('.big.primary input')).toHaveValue('#7c5cff');
  expect(await page.locator('.board canvas').first().evaluate((canvas: HTMLCanvasElement) =>
    Array.from(canvas.getContext('2d')!.getImageData(16, 16, 1, 1).data),
  )).toEqual(boardPixelBefore);
  await page.waitForFunction(async () => new Promise<boolean>((resolve) => {
    const request = indexedDB.open('pixel-editor', 2);
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const database = request.result;
      const get = database.transaction('projects', 'readonly').objectStore('projects').get('latest');
      get.onsuccess = () => {
        database.close();
        try {
          resolve(JSON.parse(get.result).references?.length === 1);
        } catch {
          resolve(false);
        }
      };
      get.onerror = () => {
        database.close();
        resolve(false);
      };
    };
  }));
});

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
  await page.getByRole('button', { name: 'Создать слой-референс' }).click();
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
