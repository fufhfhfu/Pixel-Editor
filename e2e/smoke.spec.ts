import { chromium, expect, test, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { get as httpGet } from 'node:http';
import { createServer } from 'node:net';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { productName, version } = require('../package.json') as {
  productName: string;
  version: string;
};

const targets = [
  {
    name: 'installed-layout',
    executablePath: process.env.PIXEL_EDITOR_INSTALLED_EXE
      ?? join(process.cwd(), 'release', 'win-unpacked', `${productName}.exe`),
  },
  {
    name: 'portable',
    executablePath: process.env.PIXEL_EDITOR_PORTABLE_EXE
      ?? join(process.cwd(), 'release', `${productName}-${version}-portable.exe`),
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

for (const target of targets) {
  test(`starts the packaged ${target.name} application`, async () => {
    await access(target.executablePath);
    const userDataPath = await mkdtemp(join(tmpdir(), 'pixel-editor-smoke-'));
    const port = await getAvailablePort();
    const endpoint = `http://127.0.0.1:${port}/json/version`;
    let appProcessId: number | undefined;
    let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
    let page: Page | undefined;

    try {
      const processId = await runPowerShell([
        "$ErrorActionPreference = 'Stop'",
        `$process = Start-Process -FilePath ${quotePowerShell(target.executablePath)} -ArgumentList @(${[
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
      if (!appPage) throw new Error('В упакованном приложении не открылось окно редактора.');
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
    } finally {
      if (page) await Promise.race([page.close({ runBeforeUnload: false }), new Promise((resolve) => setTimeout(resolve, 3_000))]);
      if (appProcessId) {
        await runPowerShell(`if (Get-Process -Id ${appProcessId} -ErrorAction SilentlyContinue) { Stop-Process -Id ${appProcessId} -Force }`);
      }
      await browser?.close();
      await rm(userDataPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    }
  });
}
