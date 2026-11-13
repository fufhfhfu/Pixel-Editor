import { chromium, expect, test, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { get as httpGet } from 'node:http';
import { createServer } from 'node:net';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { productName, version } = require('../package.json') as {
  productName: string;
  version: string;
};
const artifactPrefix = productName.replace(/\s+/gu, '-');

const targets = [
  {
    name: 'installed-layout',
    executablePath: process.env.PIXEL_EDITOR_INSTALLED_EXE
      ?? join(process.cwd(), 'release', 'win-unpacked', `${productName}.exe`),
  },
  {
    name: 'portable',
    executablePath: process.env.PIXEL_EDITOR_PORTABLE_EXE
      ?? join(process.cwd(), 'release', `${artifactPrefix}-${version}-portable.exe`),
  },
];

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    throw new Error('Не удалось получить порт для smoke-теста Electron.');
  }

  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

function readDebugEndpoint(endpoint: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpGet(endpoint, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${String(response.statusCode)}`));
          return;
        }
        try {
          const result = JSON.parse(body) as { webSocketDebuggerUrl?: unknown };
          if (typeof result.webSocketDebuggerUrl !== 'string') {
            reject(new Error('Electron вернул некорректный адрес WebSocket.'));
            return;
          }
          resolve(result.webSocketDebuggerUrl);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(1_000, () => request.destroy(new Error('Таймаут подключения к Electron.')));
    request.once('error', reject);
  });
}

async function waitForDebugEndpoint(endpoint: string): Promise<string> {
  const deadline = Date.now() + 90_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      return await readDebugEndpoint(endpoint);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Electron не открыл отладочный порт: ${String(lastError)}`);
}

async function runPowerShell(script: string): Promise<string> {
  const command = spawn('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '';
  let stderr = '';
  command.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  command.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const [exitCode] = await once(command, 'close') as [number | null, NodeJS.Signals | null];
  if (exitCode !== 0) throw new Error(`PowerShell завершился с кодом ${String(exitCode)}: ${stderr}`);
  return stdout.trim();
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

async function smokeExecutable(
  name: string,
  executablePath: string,
  onStarted?: (page: Page, userDataPath: string) => Promise<void>,
): Promise<void> {
  await access(executablePath);
  const userDataPath = await mkdtemp(join(tmpdir(), 'pixel-editor-smoke-'));
  const port = await getAvailablePort();
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  let appProcessId: number | undefined;
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  let page: Page | undefined;

  try {
    const processId = await runPowerShell([
      "$ErrorActionPreference = 'Stop'",
      `$process = Start-Process -FilePath ${quotePowerShell(executablePath)} -ArgumentList @(${[
        quotePowerShell(`--user-data-dir=${userDataPath}`),
        quotePowerShell(`--remote-debugging-port=${port}`),
        quotePowerShell('--remote-debugging-address=127.0.0.1'),
      ].join(', ')}) -PassThru`,
      '[Console]::WriteLine($process.Id)',
    ].join('; '));
    appProcessId = Number.parseInt(processId, 10);
    if (!Number.isInteger(appProcessId)) throw new Error(`Некорректный PID приложения: ${processId}`);
    const debugEndpoint = await waitForDebugEndpoint(endpoint);
    browser = await chromium.connectOverCDP({ endpointURL: debugEndpoint, timeout: 15_000 });
    const context = browser.contexts()[0];
    await expect.poll(() => context?.pages().length ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
    const appPage = context?.pages()[0];
    if (!appPage) throw new Error(`В упакованном приложении ${name} не открылось окно редактора.`);
    page = appPage;

    await expect(appPage.getByRole('heading', { name: 'Pixel Editor' })).toBeVisible({ timeout: 15_000 });
    expect(new URL(appPage.url()).protocol).toBe('file:');
    const contentSecurityPolicy = await appPage
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
    expect(contentSecurityPolicy).toContain("script-src 'self'");
    expect(contentSecurityPolicy).not.toContain('ws://');
    await expect.poll(() =>
      appPage.evaluate(() => typeof window.pixelEditorDesktop?.saveFile),
    ).toBe('function');
    const appInfo = await appPage.evaluate(() => window.pixelEditorDesktop?.getAppInfo());
    expect(appInfo?.version).toBe(version);
    expect(appInfo?.updatesSupported).toBe(Boolean(process.env.CSC_LINK));
    await onStarted?.(appPage, userDataPath);
  } finally {
    if (page) await Promise.race([page.close({ runBeforeUnload: false }), new Promise((resolve) => setTimeout(resolve, 3_000))]);
    if (appProcessId) {
      await runPowerShell(`if (Get-Process -Id ${appProcessId} -ErrorAction SilentlyContinue) { Stop-Process -Id ${appProcessId} -Force }`);
    }
    await browser?.close();
    await rm(userDataPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

for (const target of targets) {
  test(`starts the packaged ${target.name} application`, () => smokeExecutable(target.name, target.executablePath));
}

test('installs, starts, and uninstalls the per-user NSIS application', async () => {
  const installerPath = join(process.cwd(), 'release', `${artifactPrefix}-${version}-x64.exe`);
  const installRoot = await mkdtemp(join(tmpdir(), 'pixel-editor-nsis-'));
  const installDirectory = join(installRoot, 'Pixel Editor');
  const installedExecutable = join(installDirectory, `${productName}.exe`);
  let uninstalled = false;

  try {
    await access(installerPath);
    await runPowerShell([
      "$ErrorActionPreference = 'Stop'",
      `$process = Start-Process -FilePath ${quotePowerShell(installerPath)} -ArgumentList @('/S', ${quotePowerShell(`/D=${installDirectory}`)}) -Wait -PassThru`,
      'if ($process.ExitCode -ne 0) { throw "NSIS installation failed with exit code $($process.ExitCode)." }',
    ].join('; '));
    const projectPath = join(installRoot, 'explorer-open.pxproj');
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

    await smokeExecutable('NSIS-installed', installedExecutable, async (appPage, isolatedUserData) => {
      const welcomeButton = appPage.getByRole('button', { name: 'Начать работу' });
      if (await welcomeButton.count()) await welcomeButton.click();

      const verbKey = 'Software\\Classes\\SystemFileAssociations\\.pxproj\\shell\\open_with_pixel_editor\\command';
      const originalCommand = await runPowerShell([
        "$ErrorActionPreference = 'Stop'",
        `$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${quotePowerShell(verbKey)})`,
        'if (-not $key) { throw "Pixel Editor .pxproj context-menu verb was not registered." }',
        '$command = $key.GetValue("")',
        '$key.Close()',
        'if (-not $command) { throw "Pixel Editor .pxproj context-menu command is empty." }',
        '[Console]::WriteLine($command)',
      ].join('; '));
      const isolatedCommand = `"${installedExecutable}" --user-data-dir="${isolatedUserData}" "%1"`;
      const registry = `[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${quotePowerShell(verbKey)}, $true)`;
      try {
        await runPowerShell([
          "$ErrorActionPreference = 'Stop'",
          `$key = ${registry}`,
          'if (-not $key) { throw "Pixel Editor .pxproj context-menu verb was not registered." }',
          `$key.SetValue("", ${quotePowerShell(isolatedCommand)}, [Microsoft.Win32.RegistryValueKind]::String)`,
          '$key.Close()',
          `Start-Process -FilePath ${quotePowerShell(projectPath)} -Verb open_with_pixel_editor`,
        ].join('; '));
        const importDialog = appPage.getByRole('dialog', { name: 'Открыть проект?' });
        await expect(importDialog).toBeVisible({ timeout: 15_000 });
        await importDialog.getByRole('button', { name: 'Открыть', exact: true }).click();
        await expect(appPage.locator('.board.selected > canvas:not(.transform-preview):not(.selection-overlay)'))
          .toHaveJSProperty('width', 7);
      } finally {
        await runPowerShell([
          "$ErrorActionPreference = 'Stop'",
          `$key = ${registry}`,
          'if (-not $key) { throw "Pixel Editor .pxproj context-menu verb disappeared during the test." }',
          `$key.SetValue("", ${quotePowerShell(originalCommand)}, [Microsoft.Win32.RegistryValueKind]::String)`,
          '$key.Close()',
        ].join('; '));
      }
    });

    const uninstaller = await runPowerShell([
      "$ErrorActionPreference = 'Stop'",
      `$entry = Get-ChildItem -LiteralPath ${quotePowerShell(installDirectory)} -File -Filter '*uninstall*.exe' | Select-Object -First 1`,
      'if (-not $entry) { throw "NSIS uninstaller was not created." }',
      '[Console]::WriteLine($entry.FullName)',
    ].join('; '));
    await runPowerShell([
      "$ErrorActionPreference = 'Stop'",
      `$process = Start-Process -FilePath ${quotePowerShell(uninstaller)} -ArgumentList '/S' -Wait -PassThru`,
      'if ($process.ExitCode -ne 0) { throw "NSIS uninstall failed with exit code $($process.ExitCode)." }',
    ].join('; '));
    uninstalled = true;
    await expect(access(installedExecutable)).rejects.toThrow();
  } finally {
    if (!uninstalled) {
      await runPowerShell([
        "$ErrorActionPreference = 'Stop'",
        `$entry = Get-ChildItem -LiteralPath ${quotePowerShell(installDirectory)} -File -Filter '*uninstall*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1`,
        'if ($entry) { Start-Process -FilePath $entry.FullName -ArgumentList \'/S\' -Wait }',
      ].join('; '));
    }
    await rm(installRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
});
