import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, vi } from 'vitest';
import { AutosaveRepository } from '../core/autosave';
import type { ProjectData } from '../core/project';
import { WELCOME_SEEN_KEY } from '../core/feedbackNotes';
import App from '../App.svelte';

interface PutCall {
  dirty: [number, number, number, number];
}

export const putCalls: PutCall[] = [];
export let canvasData: Uint8ClampedArray | null = null;
export const rasterDrawCalls: number[][] = [];
export const desktopSaveFile = vi.fn(async () => ({ status: 'saved', fileName: 'art.json' } as const));
export const desktopSaveProjectFile = vi.fn(async () => ({
  status: 'saved',
  fileName: 'art.pxproj',
  handle: 'test-project',
  recentProjects: [],
} as const));

function installDomStubs(): void {
  const proto = HTMLCanvasElement.prototype as unknown as { getContext: () => unknown };
  proto.getContext = function (this: HTMLCanvasElement) {
    const canvas = this;
    return {
      putImageData(image: { data: Uint8ClampedArray }, _dx: number, _dy: number, x: number, y: number, w: number, h: number) {
        if (canvas.classList.contains('thumbnail') || canvas.classList.contains('selection-overlay') ||
          canvas.classList.contains('transform-preview') || canvas.classList.contains('reference-image')) return;
        canvasData = image.data;
        putCalls.push({ dirty: [x, y, w, h] });
      },
      clearRect() {},
      fillRect() {},
      drawImage(_image: CanvasImageSource, ...args: number[]) {
        rasterDrawCalls.push(args);
      },
      getImageData(_x: number, _y: number, width: number, height: number) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 3; i < data.length; i += 4) data[i] = 255;
        return { data, width, height };
      },
    };
  };
  (globalThis as unknown as { ImageData: unknown }).ImageData = class {
    data: Uint8ClampedArray;
    constructor(data: Uint8ClampedArray, public width: number, public height: number) {
      this.data = data;
    }
  };
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    constructor(private cb: (entries: unknown[]) => void) {}
    observe() {
      this.cb([{ contentRect: { width: 800, height: 600 } }]);
    }
    disconnect() {}
  };
  (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = class extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  };
  Element.prototype.setPointerCapture = function () {};
  Element.prototype.releasePointerCapture = function () {};
  Element.prototype.hasPointerCapture = function () {
    return true;
  };
  Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} } as DOMRect;
  };
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
}

let app: ReturnType<typeof mount> | null = null;

async function mountApp(initialProject?: ProjectData): Promise<void> {
  const repository = new AutosaveRepository(null, localStorage);
  const startup = await repository.load();
  app = mount(App, {
    target: document.getElementById('app')!,
    props: {
      initialProject: initialProject ?? startup.project,
      initialLoadError: startup.error,
      initialStorageMode: startup.mode,
      autosaveRepository: repository,
    },
  });
  await tick();
}

export async function remountApp(initialProject?: ProjectData): Promise<void> {
  if (app) unmount(app);
  app = null;
  await mountApp(initialProject);
}

export function viewport(): HTMLElement {
  return document.querySelector('.viewport') as HTMLElement;
}

export function stage(): HTMLElement {
  return document.querySelector('.stage') as HTMLElement;
}

export function screenOf(x: number, y: number, boardIndex = 0): { x: number; y: number } {
  const board = document.querySelectorAll('.board')[boardIndex] as HTMLElement;
  const canvas = board.querySelector('canvas')!;
  const zoom = parseFloat(board.style.width) / canvas.width;
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(stage().style.transform)!;
  return {
    x: parseFloat(match[1]) + parseFloat(board.style.left) + (x + 0.5) * zoom,
    y: parseFloat(match[2]) + parseFloat(board.style.top) + (y + 0.5) * zoom,
  };
}

export function pointer(type: string, point: { x: number; y: number }, init: PointerEventInit = {}): void {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    ...init,
  });
  viewport().dispatchEvent(event);
  flushSync();
}

export function key(code: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    code,
    key: init.key ?? code,
    bubbles: true,
    cancelable: true,
    ...init,
  }));
  flushSync();
}

export const canvasAlpha = (x: number, y: number): number => canvasData![(y * 32 + x) * 4 + 3];

export async function frame(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  await tick();
}

export function drawStroke(from: [number, number], to: [number, number], init: PointerEventInit = {}): void {
  pointer('pointerdown', screenOf(...from), init);
  pointer('pointermove', screenOf(...to), { ...init, button: -1 });
  pointer('pointerup', screenOf(...to), init);
}

beforeEach(async () => {
  installDomStubs();
  putCalls.length = 0;
  canvasData = null;
  rasterDrawCalls.length = 0;
  desktopSaveFile.mockClear();
  desktopSaveProjectFile.mockClear();
  localStorage.clear();
  localStorage.setItem(WELCOME_SEEN_KEY, 'true');
  Object.defineProperty(window, 'pixelEditorDesktop', {
    configurable: true,
    value: {
      saveFile: desktopSaveFile,
      saveProjectFile: desktopSaveProjectFile,
      updateWindowState: vi.fn(),
    },
  });
  document.body.innerHTML = '<div id="app"></div>';
  await mountApp();
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  delete (window as Window & { pixelEditorDesktop?: unknown }).pixelEditorDesktop;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
