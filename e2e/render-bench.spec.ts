import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  serializeProject,
  type ProjectAnimationFrameData,
  type ProjectCanvasData,
  type ProjectData,
  type ProjectLayerData,
} from '../src/core/project';

const require = createRequire(import.meta.url);
const electronExecutable = require('electron') as string;
const electronVersion = (require('electron/package.json') as { version: string }).version;

interface PaintSample {
  atMs: number;
  durationMs: number;
  canvasId: number;
  width: number;
  height: number;
  pixels: number;
}

interface RenderCapture {
  elapsedMs: number;
  samples: PaintSample[];
  animationIntervalsMs: number[];
}

interface BrowserRenderBench {
  capture: boolean;
  recordAnimationFrames: boolean;
  startTime: number;
  samples: PaintSample[];
  animationIntervalsMs: number[];
  startCapture(): void;
  startAnimationCapture(): void;
  stopCapture(): RenderCapture;
}

type BenchWindow = Window & { __pixelRenderBench?: BrowserRenderBench };

interface Scenario {
  name: string;
  width: number;
  height: number;
  boardCount: number;
  layersPerBoard: number;
  animationFrameCount?: number;
}

let electronApp: ElectronApplication;
let page: Page;
let userDataPath: string;

function makePixels(width: number, height: number, seed: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      pixels[offset] = (x * 13 + y * 7 + seed * 31) % 256;
      pixels[offset + 1] = (x * 3 + y * 17 + seed * 47) % 256;
      pixels[offset + 2] = (x * 11 + y * 5 + seed * 67) % 256;
      pixels[offset + 3] = (x + y + seed) % 9 === 0 ? 144 : 255;
    }
  }
  return pixels;
}

function makeLayer(
  scenario: Scenario,
  boardIndex: number,
  layerIndex: number,
): ProjectLayerData {
  const layerId = `board-${boardIndex + 1}-layer-${layerIndex + 1}`;
  const layer: ProjectLayerData = {
    id: layerId,
    name: `Bench layer ${String(layerIndex + 1).padStart(2, '0')}`,
    pixels: makePixels(scenario.width, scenario.height, boardIndex * 17 + layerIndex + 1),
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: layerIndex % 3 === 0 ? 'normal' : layerIndex % 3 === 1 ? 'multiply' : 'screen',
    alphaLock: false,
    clippingMask: false,
  };

  if (scenario.animationFrameCount && layerIndex === scenario.layersPerBoard - 1 && boardIndex === 0) {
    const animationFrames: ProjectAnimationFrameData[] = Array.from(
      { length: scenario.animationFrameCount },
      (_, frameIndex) => ({
        id: `frame-${frameIndex + 1}`,
        durationMs: 80,
        pixels: makePixels(scenario.width, scenario.height, 100 + frameIndex),
      }),
    );
    layer.animationFrames = animationFrames;
  }

  return layer;
}

function makeProject(scenario: Scenario): ProjectData {
  const canvases: ProjectCanvasData[] = Array.from({ length: scenario.boardCount }, (_, boardIndex) => {
    const layers = Array.from({ length: scenario.layersPerBoard }, (_, layerIndex) =>
      makeLayer(scenario, boardIndex, layerIndex),
    );
    const activeLayer = layers.at(-1)!;
    return {
      id: `benchmark-board-${boardIndex + 1}`,
      x: boardIndex * (scenario.width + 32),
      y: 0,
      width: scenario.width,
      height: scenario.height,
      pixels: layers[0]!.pixels,
      activeLayerId: activeLayer.id,
      layers,
    };
  });

  return {
    width: scenario.width,
    height: scenario.height,
    pixels: canvases[0]!.pixels,
    paletteId: 'pico8',
    freeColor: false,
    primary: { r: 255, g: 0, b: 77, a: 255 },
    secondary: { r: 255, g: 241, b: 232, a: 255 },
    recent: [],
    canvases,
    activeCanvasId: canvases[0]!.id,
  };
}

function summarize(values: number[]): Record<string, number> {
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  const percentile = (fraction: number) => sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!
    : 0;
  const round = (value: number) => Number(value.toFixed(3));
  return {
    count: values.length,
    totalMs: round(total),
    meanMs: round(values.length ? total / values.length : 0),
    p50Ms: round(percentile(0.5)),
    p95Ms: round(percentile(0.95)),
    maxMs: round(sorted.at(-1) ?? 0),
  };
}

function summarizePaint(capture: RenderCapture) {
  const byCanvas = new Map<number, PaintSample[]>();
  for (const sample of capture.samples) {
    const samples = byCanvas.get(sample.canvasId) ?? [];
    samples.push(sample);
    byCanvas.set(sample.canvasId, samples);
  }
  return {
    calls: capture.samples.length,
    canvases: [...byCanvas].map(([canvasId, samples]) => ({
      canvasId,
      width: samples[0]!.width,
      height: samples[0]!.height,
      calls: samples.length,
    })),
    pixelsSubmitted: capture.samples.reduce((sum, sample) => sum + sample.pixels, 0),
    synchronousPutImageDataMs: summarize(capture.samples.map((sample) => sample.durationMs)),
    firstPutImageDataMs: Number((capture.samples[0]?.atMs ?? 0).toFixed(3)),
  };
}

async function installRenderInstrumentation(): Promise<void> {
  await page.evaluate(() => {
    const target = window as BenchWindow;
    if (target.__pixelRenderBench) return;

    const state: BrowserRenderBench = {
      startCapture() {
        this.stopCapture();
        this.samples = [];
        this.animationIntervalsMs = [];
        this.startTime = performance.now();
        this.capture = true;
      },
      startAnimationCapture() {
        this.startCapture();
        this.animationIntervalsMs = [];
        this.recordAnimationFrames = true;
        let previousTime: number | undefined;
        const record = (time: number) => {
          if (!this.recordAnimationFrames) return;
          if (previousTime !== undefined) this.animationIntervalsMs.push(time - previousTime);
          previousTime = time;
          requestAnimationFrame(record);
        };
        requestAnimationFrame(record);
      },
      stopCapture() {
        this.capture = false;
        this.recordAnimationFrames = false;
        return {
          elapsedMs: performance.now() - this.startTime,
          samples: [...this.samples],
          animationIntervalsMs: [...this.animationIntervalsMs],
        };
      },
      capture: false,
      recordAnimationFrames: false,
      startTime: 0,
      samples: [],
      animationIntervalsMs: [],
    };
    target.__pixelRenderBench = state;

    const prototype = CanvasRenderingContext2D.prototype;
    const original = prototype.putImageData;
    const canvasIds = new WeakMap<HTMLCanvasElement, number>();
    let nextCanvasId = 1;
    prototype.putImageData = function (
      this: CanvasRenderingContext2D,
      image: ImageData,
      dx: number,
      dy: number,
      dirtyX?: number,
      dirtyY?: number,
      dirtyWidth?: number,
      dirtyHeight?: number,
    ): void {
      const start = performance.now();
      if (
        dirtyX === undefined || dirtyY === undefined ||
        dirtyWidth === undefined || dirtyHeight === undefined
      ) {
        Reflect.apply(original, this, [image, dx, dy]);
      } else {
        Reflect.apply(original, this, [image, dx, dy, dirtyX, dirtyY, dirtyWidth, dirtyHeight]);
      }
      const end = performance.now();
      const canvas = this.canvas;
      if (
        !state.capture ||
        !canvas.closest('.board') ||
        canvas.classList.contains('transform-preview') ||
        canvas.classList.contains('selection-overlay')
      ) return;
      let canvasId = canvasIds.get(canvas);
      if (canvasId === undefined) {
        canvasId = nextCanvasId++;
        canvasIds.set(canvas, canvasId);
      }
      state.samples.push({
        atMs: end - state.startTime,
        durationMs: end - start,
        canvasId,
        width: image.width,
        height: image.height,
        pixels: dirtyWidth === undefined || dirtyHeight === undefined
          ? image.width * image.height
          : dirtyWidth * dirtyHeight,
      });
    };
  });
}

async function importProject(json: string, boardCount: number): Promise<RenderCapture> {
  await page.evaluate(() => (window as BenchWindow).__pixelRenderBench!.startCapture());
  const projectPath = join(userDataPath, 'render-benchmark.json');
  await writeFile(projectPath, json);
  await page.locator('.menu-bar input[type="file"]').setInputFiles(projectPath, { timeout: 120_000 });
  const dialog = page.getByRole('dialog', { name: 'Открыть проект?' });
  await dialog.getByRole('button', { name: 'Открыть', exact: true }).click();
  await expect(page.locator('.board')).toHaveCount(boardCount);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const capture = await page.evaluate(() => (window as BenchWindow).__pixelRenderBench!.stopCapture());
  expect(capture.samples.length).toBeGreaterThan(0);
  expect(new Set(capture.samples.map((sample) => sample.canvasId)).size).toBe(boardCount);
  return capture;
}

async function measureLayerToggle(layerName: string, visibleBefore: boolean) {
  return page.evaluate(async ({ layerName, visibleBefore }) => {
    const label = `${visibleBefore ? 'Скрыть' : 'Показать'} ${layerName}`;
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.layers-panel button'))
      .find((entry) => entry.getAttribute('aria-label') === label);
    if (!button) throw new Error(`Не найдена кнопка видимости слоя: ${label}`);

    const benchmark = (window as BenchWindow).__pixelRenderBench!;
    benchmark.startCapture();
    const startedAt = performance.now();
    button.click();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    const interactionToPaintMs = performance.now() - startedAt;
    return { interactionToPaintMs, capture: benchmark.stopCapture() };
  }, { layerName, visibleBefore });
}

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

async function waitForAnimationControl(): Promise<void> {
  if (await page.locator('.timeline [aria-label="Воспроизвести"]').count()) return;
  await clickNativeMenuItem('Анимация', 'Показать или скрыть Timeline');
  await expect(page.locator('.timeline')).toBeVisible();
}

test.describe.serial('Render performance baseline', () => {
  test.setTimeout(300_000);

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    userDataPath = await mkdtemp(join(tmpdir(), 'pixel-editor-render-bench-'));
    electronApp = await electron.launch({
      executablePath: electronExecutable,
      args: [process.cwd(), `--user-data-dir=${userDataPath}`],
    });
    page = await electronApp.firstWindow();
    await expect(page.getByRole('heading', { name: 'Pixel Editor' })).toBeVisible({ timeout: 60_000 });
    const welcomeButton = page.getByRole('button', { name: 'Начать работу' });
    if (await welcomeButton.count()) await welcomeButton.click();
    await electronApp.evaluate(({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      mainWindow?.show();
      mainWindow?.focus();
    });
    await installRenderInstrumentation();
  });

  test.afterAll(async () => {
    test.setTimeout(30_000);
    await electronApp?.close();
    await rm(userDataPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  });

  test('measures typical, large, multi-canvas, and animated projects', async () => {
    const scenarios: Scenario[] = [
      { name: 'typical-256px-6-layers', width: 256, height: 256, boardCount: 1, layersPerBoard: 6 },
      { name: 'large-1024px-4-layers', width: 1024, height: 1024, boardCount: 1, layersPerBoard: 4 },
      { name: 'multi-canvas-4x256px-4-layers', width: 256, height: 256, boardCount: 4, layersPerBoard: 4 },
      {
        name: 'animation-512px-4-layers-8-frames',
        width: 512,
        height: 512,
        boardCount: 1,
        layersPerBoard: 4,
        animationFrameCount: 8,
      },
    ];
    const results: Record<string, unknown>[] = [];

    for (const scenario of scenarios) {
      const generationStart = performance.now();
      const json = serializeProject(makeProject(scenario));
      const fixtureGenerationMs = performance.now() - generationStart;
      const capture = await importProject(json, scenario.boardCount);
      results.push({
        scenario: scenario.name,
        size: `${scenario.width}x${scenario.height}`,
        boardCount: scenario.boardCount,
        layersPerBoard: scenario.layersPerBoard,
        animationFrameCount: scenario.animationFrameCount ?? 0,
        projectBytes: Buffer.byteLength(json),
        fixtureGenerationMs: Number(fixtureGenerationMs.toFixed(3)),
        openToPaintMs: Number(capture.elapsedMs.toFixed(3)),
        paint: summarizePaint(capture),
      });

      if (scenario.name === 'typical-256px-6-layers') {
        await page.getByRole('button', { name: 'Layers', exact: true }).click();
        await page.locator('.layers-panel summary').click();
        const layerName = 'Bench layer 06';
        await expect(page.getByRole('button', { name: `Скрыть ${layerName}` })).toBeVisible();
        const hide = await measureLayerToggle(layerName, true);
        const show = await measureLayerToggle(layerName, false);
        expect(hide.capture.samples.length).toBeGreaterThan(0);
        expect(show.capture.samples.length).toBeGreaterThan(0);
        results.push({
          scenario: 'typical-layer-visibility-toggle',
          hideToPaintMs: Number(hide.interactionToPaintMs.toFixed(3)),
          hidePaint: summarizePaint(hide.capture),
          showToPaintMs: Number(show.interactionToPaintMs.toFixed(3)),
          showPaint: summarizePaint(show.capture),
        });
      }

      if (scenario.animationFrameCount) {
        await waitForAnimationControl();
        await expect(page.locator('.timeline .frame')).toHaveCount(scenario.animationFrameCount);
        await page.locator('.timeline [aria-label="Воспроизвести"]').click();
        const animation = await page.evaluate(async () => {
          const benchmark = (window as BenchWindow).__pixelRenderBench!;
          benchmark.startAnimationCapture();
          await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
          return benchmark.stopCapture();
        });
        await page.locator('.timeline [aria-label="Остановить воспроизведение"]').click();
        expect(animation.samples.length).toBeGreaterThan(0);
        expect(animation.animationIntervalsMs.length).toBeGreaterThan(0);
        results.push({
          scenario: 'animation-playback-2-seconds',
          durationMs: Number(animation.elapsedMs.toFixed(3)),
          animationFrameCount: scenario.animationFrameCount,
          requestAnimationFrameIntervalsMs: summarize(animation.animationIntervalsMs),
          paint: summarizePaint(animation),
        });
      }
    }

    const environment = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
    }));
    console.log('\nRENDER BENCHMARK BASELINE\n' + JSON.stringify({
      capturedAt: new Date().toISOString(),
      node: process.version,
      electron: electronVersion,
      platform: process.platform,
      architecture: process.arch,
      environment,
      measurements: results,
    }, null, 2));
  });
});
