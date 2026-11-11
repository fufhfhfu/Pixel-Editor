import { _electron as electron, expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const electronExecutable = require('electron') as string;

test('runs the editor in Electron and imports project notes', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'pixel-editor-desktop-e2e-'));
  let electronApp: Awaited<ReturnType<typeof electron.launch>> | undefined;

  try {
    electronApp = await electron.launch({
      executablePath: electronExecutable,
      args: [process.cwd(), `--user-data-dir=${userDataPath}`],
    });
    const page = await electronApp.firstWindow();
    await expect(page.getByRole('heading', { name: 'Pixel Editor' })).toBeVisible();
    await expect.poll(() =>
      page.evaluate(() => typeof window.pixelEditorDesktop?.onCommand),
    ).toBe('function');

    const welcomeButton = page.getByRole('button', { name: 'Начать работу' });
    if (await welcomeButton.count()) await welcomeButton.click();
    await page.getByRole('button', { name: 'Заметки проекта' }).click();
    await page.locator('input[accept*=".markdown"]').setInputFiles({
      name: 'project-notes.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Project notes\n\nImport works in Electron.'),
    });

    await expect(page.getByRole('textbox', { name: 'Текст заметок' }))
      .toHaveValue('# Project notes\n\nImport works in Electron.');
  } finally {
    await electronApp?.close();
    await rm(userDataPath, { recursive: true, force: true });
  }
});
