<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { ColorSlot } from '../core/palette';
  import { PixelRenderer } from '../core/render';
  import type { PixelBuffer, RGBA } from '../core/state';
  import {
    combineSelections,
    createColorSelection,
    createEllipseSelection,
    createPolygonSelection,
    createRectSelection,
    type SelectionMask,
    type SelectionMode,
    type SelectionOperation,
  } from '../core/selection';
  import { StrokeSession, type StrokeOutcome } from '../core/stroke';
  import {
    getTool,
    type BrushDefinition,
    type BrushShape,
    type DrawingSettings,
    type Tool,
    type ToolContext,
  } from '../core/tools';
  import {
    centerView,
    ensurePixelVisible,
    fitView,
    screenToPixel,
    zoomAt,
    type PixelPos,
    type ViewState,
  } from '../core/viewport';
  import type { GridMode } from '../core/preferences';
  import { referenceAtPoint, sampleReferenceColor, type ReferenceImage } from '../core/reference';
  import {
    getSceneBounds as getCanvasSceneBounds,
    guideBox as getAlignmentGuideBox,
    guideLine as getAlignmentGuideLine,
    snapBoardPosition as snapCanvasBoardPosition,
    type AlignmentGuide,
    type CanvasBoardGeometry,
  } from '../core/canvasNavigation';
  import {
    beginPinchGesture,
    updatePinchGesture,
    type PinchGesture,
    type TouchPoint,
  } from '../core/canvasGestures';

  interface Board {
    id: string;
    x: number;
    y: number;
    buffer: PixelBuffer;
  }

  export interface ViewportGuide {
    id: string;
    boardId: string;
    axis: 'x' | 'y';
    position: number;
  }

  function drawSelectionOverlay(id: string): void {
    const canvas = selectionCanvases.get(id);
    const board = boards.find((entry) => entry.id === id);
    if (!canvas || !board) return;
    if (canvas.width !== board.buffer.width || canvas.height !== board.buffer.height) {
      canvas.width = board.buffer.width;
      canvas.height = board.buffer.height;
    }
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось создать контекст отображения выделения.');
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const activeSelection = previewSelection ?? selectionMask;
    if (id === activeBoardId && activeSelection && activeSelection.width === canvas.width && activeSelection.height === canvas.height) {
      const { width, height, data: selected } = activeSelection;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const pixel = y * width + x;
          if (!selected[pixel]) continue;
          const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
            !selected[pixel - 1] || !selected[pixel + 1] ||
            !selected[pixel - width] || !selected[pixel + width];
          if (!edge) continue;
          const offset = pixel * 4;
          const color = (x + y) % 2 === 0 ? 255 : 0;
          image.data[offset] = color;
          image.data[offset + 1] = color;
          image.data[offset + 2] = color;
          image.data[offset + 3] = 255;
        }
      }
    }
    context.putImageData(image, 0, 0);
  }

  export function openPreviewWindow(): void {
    if (previewWindow && !previewWindow.closed) {
      previewWindow.focus();
      void updatePreviewWindow();
      return;
    }

    const opened = window.open('', 'pixel-editor-preview', 'popup,width=800,height=700,resizable=yes');
    if (!opened) throw new Error('Браузер заблокировал окно предпросмотра.');
    previewWindow = opened;
    opened.document.open();
    opened.document.write(`<!doctype html>
      <html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Предпросмотр Pixel Editor</title>
      <style>
        *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0}
        body{display:grid;place-items:center;overflow:hidden;background-color:#30323a;
          background-image:linear-gradient(45deg,#454751 25%,transparent 25%),linear-gradient(-45deg,#454751 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#454751 75%),linear-gradient(-45deg,transparent 75%,#454751 75%);
          background-position:0 0,0 8px,8px -8px,-8px 0;background-size:16px 16px}
        canvas{max-width:96vw;max-height:90vh;width:auto;height:auto;image-rendering:pixelated;box-shadow:0 8px 32px #0009}
        #size{position:fixed;left:12px;top:10px;padding:5px 8px;border-radius:4px;background:#171820cc;color:#fff;font:12px system-ui}
      </style></head><body><span id="size">Ожидание холста…</span><canvas></canvas>
      <script>
        let sequence=0,currentWidth=1,currentHeight=1;
        const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
        function layout(){const scale=Math.min(8,innerWidth*.9/currentWidth,innerHeight*.9/currentHeight);canvas.style.width=Math.max(1,Math.floor(currentWidth*scale))+'px';canvas.style.height=Math.max(1,Math.floor(currentHeight*scale))+'px'}
        addEventListener('resize',layout);
        addEventListener('message',event=>{
          if(event.source!==opener||event.data?.type!=='pixel-editor-preview'||!(event.data.bitmap instanceof ImageBitmap))return;
          const bitmap=event.data.bitmap;
          if(event.data.sequence<=sequence){bitmap.close();return}
          sequence=event.data.sequence;
          currentWidth=bitmap.width;currentHeight=bitmap.height;
          canvas.width=bitmap.width;canvas.height=bitmap.height;ctx.imageSmoothingEnabled=false;
          ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0);bitmap.close();
          layout();
          document.title='Предпросмотр '+canvas.width+'×'+canvas.height;
          document.querySelector('#size').textContent=canvas.width+'×'+canvas.height;
        });
        addEventListener('keydown',event=>{if(event.key==='Escape')close()});
      <\/script></body></html>`);
    opened.document.close();
    if (previewWindowTimer) clearInterval(previewWindowTimer);
    previewWindowTimer = setInterval(() => {
      if (!previewWindow || previewWindow.closed) {
        previewWindow = null;
        clearInterval(previewWindowTimer);
        previewWindowTimer = undefined;
      }
    }, 1000);
    opened.focus();
    void updatePreviewWindow();
  }

  async function updatePreviewWindow(): Promise<void> {
    const target = previewWindow;
    if (!target || target.closed) return;
    const source = canvasElements.get(activeBoardId);
    if (!source) return;
    const sequence = ++previewSequence;
    try {
      const bitmap = await createImageBitmap(source);
      if (target !== previewWindow || target.closed || sequence !== previewSequence) {
        bitmap.close();
        return;
      }
      target.postMessage(
        { type: 'pixel-editor-preview', sequence, bitmap },
        window.location.origin,
        [bitmap],
      );
    } catch (error) {
      if (target === previewWindow) {
        target.close();
        previewWindow = null;
        onpreviewerror(error instanceof Error ? error.message : 'Не удалось обновить окно предпросмотра.');
      }
    }
  }

  function renderTiledPreview(): void {
    const canvas = tiledPreviewCanvas;
    const board = boards.find((entry) => entry.id === activeBoardId);
    const source = board ? canvasElements.get(board.id) : undefined;
    if (!canvas || !board || !source || !tiledMode || !viewW || !viewH) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(viewW * ratio));
    const height = Math.max(1, Math.round(viewH * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      onpreviewerror('Не удалось создать контекст режима повторения.');
      return;
    }
    context.clearRect(0, 0, width, height);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.imageSmoothingEnabled = false;
    const tileWidth = board.buffer.width * view.zoom;
    const tileHeight = board.buffer.height * view.zoom;
    if (tileWidth < 1 || tileHeight < 1) return;
    const originX = view.offsetX + board.x * view.zoom;
    const originY = view.offsetY + board.y * view.zoom;
    const minColumn = Math.floor(-originX / tileWidth) - 1;
    const maxColumn = Math.ceil((viewW - originX) / tileWidth) + 1;
    const minRow = Math.floor(-originY / tileHeight) - 1;
    const maxRow = Math.ceil((viewH - originY) / tileHeight) + 1;
    if ((maxColumn - minColumn + 1) * (maxRow - minRow + 1) > 2500) return;
    for (let row = minRow; row <= maxRow; row++) {
      for (let column = minColumn; column <= maxColumn; column++) {
        context.drawImage(
          source,
          originX + column * tileWidth,
          originY + row * tileHeight,
          tileWidth,
          tileHeight,
        );
      }
    }
  }

  function scheduleTiledPreview(): void {
    if (tiledRenderFrame) cancelAnimationFrame(tiledRenderFrame);
    tiledRenderFrame = requestAnimationFrame(() => {
      tiledRenderFrame = 0;
      renderTiledPreview();
    });
  }

  $effect(() => {
    void tiledMode;
    void view.offsetX;
    void view.offsetY;
    void view.zoom;
    void activeBoardId;
    void boards;
    if (tiledMode) scheduleTiledPreview();
  });

  $effect(() => {
    void activeBoardId;
    void boards;
    if (previewWindow && !previewWindow.closed) {
      requestAnimationFrame(() => void updatePreviewWindow());
    }
  });

  function drawTransformPreview(id: string): void {
    const canvas = transformPreviewCanvases.get(id);
    const board = boards.find((entry) => entry.id === id);
    if (!canvas || !board) return;
    if (canvas.width !== board.buffer.width || canvas.height !== board.buffer.height) {
      canvas.width = board.buffer.width;
      canvas.height = board.buffer.height;
    }
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось создать контекст предпросмотра трансформации.');
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    if (id === activeBoardId && previewBuffer &&
      previewBuffer.width === canvas.width && previewBuffer.height === canvas.height) {
      image.data.set(previewBuffer.data);
    }
    context.putImageData(image, 0, 0);
  }

  function registerSelectionCanvas(element: HTMLCanvasElement, id: string) {
    selectionCanvases.set(id, element);
    drawSelectionOverlay(id);
    return {
      destroy() {
        selectionCanvases.delete(id);
      },
    };
  }

  function registerTransformPreviewCanvas(element: HTMLCanvasElement, id: string) {
    transformPreviewCanvases.set(id, element);
    drawTransformPreview(id);
    return {
      destroy() {
        transformPreviewCanvases.delete(id);
      },
    };
  }

  $effect(() => {
    const currentSelection = selectionMask;
    const currentActiveBoard = activeBoardId;
    for (const board of boards) {
      void board.buffer;
      drawSelectionOverlay(board.id);
      drawTransformPreview(board.id);
    }
    void currentSelection;
    void currentActiveBoard;
  });

  interface Props {
    buffer: PixelBuffer;
    boards: readonly Board[];
    references: readonly ReferenceImage[];
    selectedReferenceId: string | null;
    activeBoardId: string;
    view: ViewState;
    cursor: PixelPos | null;
    showGrid: boolean;
    gridMode: GridMode;
    gridSpacing: number;
    snapToGrid: boolean;
    checkerboard: boolean;
    tiledMode: boolean;
    symmetryX: boolean;
    symmetryY: boolean;
    guides: readonly ViewportGuide[];
    panMode: boolean;
    canvasBackground: string;
    workspaceBackground: string;
    tool: Tool;
    secondaryColorDrawing: boolean;
    primary: RGBA;
    secondary: RGBA;
    brushSize: number;
    brushShape: BrushShape;
    brushOpacity: number;
    brushDefinition: BrushDefinition | null;
    settings: DrawingSettings;
    temporaryPicker: boolean;
    fillInProgress: boolean;
    selectionMask: SelectionMask | null;
    previewSelection: SelectionMask | null;
    selectionMode: SelectionMode | null;
    selectionOperation: SelectionOperation;
    /** Пипетка выбрала цвет для слота. */
    onpickcolor: (slot: ColorSlot, color: RGBA) => void;
    /** Штрих начат этим цветом (для списка недавних). */
    onusecolor: (color: RGBA) => void;
    /** Перед первым изменением штриха (история запоминает исходное состояние). */
    onstrokebegin: () => void;
    /** После штриха: commit — записать в историю, rollback — откатить целиком. */
    onstrokeend: (outcome: StrokeOutcome) => void;
    onfill: (x: number, y: number, slot: ColorSlot) => void;
    onrender: () => void;
    onselectboard: (id: string) => void;
    onmoveboard: (id: string, x: number, y: number) => void;
    onmoveboards: (positions: Array<{ id: string; x: number; y: number }>) => void;
    ondeleteboard: (id: string) => void;
    onfitboard: (id: string) => void;
    onselectreference: (id: string) => void;
    onreferencemovestart: () => void;
    onreferencemove: (id: string, x: number, y: number) => void;
    onreferencemoveend: () => void;
    onreferencemovecancel: () => void;
    onselection: (selection: SelectionMask | null) => void;
    onguideschange: (guides: ViewportGuide[]) => void;
    onpreviewerror: (message: string) => void;
    previewBuffer: PixelBuffer | null;
    onconfirmtransform: () => void;
    oncanceltransform: () => void;
  }

  let {
    buffer,
    boards,
    references,
    selectedReferenceId,
    activeBoardId,
    view = $bindable(),
    cursor = $bindable(),
    showGrid,
    gridMode,
    gridSpacing,
    snapToGrid,
    checkerboard,
    tiledMode,
    symmetryX,
    symmetryY,
    guides,
    panMode,
    canvasBackground,
    workspaceBackground,
    tool,
    secondaryColorDrawing,
    primary,
    secondary,
    brushSize,
    brushShape,
    brushOpacity,
    brushDefinition,
    settings,
    temporaryPicker,
    fillInProgress,
    selectionMask,
    previewSelection,
    selectionMode,
    selectionOperation,
    previewBuffer,
    onpickcolor,
    onusecolor,
    onstrokebegin,
    onstrokeend,
    onfill,
    onrender,
    onselectboard,
    onmoveboard,
    onmoveboards,
    ondeleteboard,
    onfitboard,
    onselectreference,
    onreferencemovestart,
    onreferencemove,
    onreferencemoveend,
    onreferencemovecancel,
    onselection,
    onguideschange,
    onpreviewerror,
    onconfirmtransform,
    oncanceltransform,
  }: Props = $props();

  /** Ниже этого зума линии сетки слишком частые и не рисуются. */
  const GRID_MIN_ZOOM = 4;
  /** Накопленный deltaY колеса, соответствующий одному шагу зума. */
  const WHEEL_STEP = 100;
  const MAX_WHEEL_STEPS = 3;
  /** Шаг клавиатурного курсора с зажатым Shift. */
  const KEYBOARD_BIG_STEP = 8;
  const ARROWS: Record<string, readonly [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  let viewportEl: HTMLDivElement | undefined = $state();
  let tiledPreviewCanvas: HTMLCanvasElement | undefined = $state();
  let panning = $state(false);
  let focused = $state(false);
  let keyboardCursorShown = $state(false);
  let keyboardX = $state(0);
  let keyboardY = $state(0);
  let keyboardPenDown = $state(false);

  const renderers = new Map<string, { canvas: HTMLCanvasElement; buffer: PixelBuffer; renderer: PixelRenderer }>();
  const canvasElements = new Map<string, HTMLCanvasElement>();
  const selectionCanvases = new Map<string, HTMLCanvasElement>();
  const transformPreviewCanvases = new Map<string, HTMLCanvasElement>();
  let frame = 0;
  let previewWindow: Window | null = null;
  let previewWindowTimer: ReturnType<typeof setInterval> | undefined;
  let previewSequence = 0;
  let tiledRenderFrame = 0;

  let viewW = 0;
  let viewH = 0;
  let originX = 0;
  let originY = 0;
  let fittedSignature = '';
  let wheelAcc = 0;
  let lastClient: { x: number; y: number } | null = null;
  let panPointerId = -1;
  let rightPanPointerId = -1;
  let rightClickBoardId: string | null = null;
  let boardContextMenu = $state<{ boardId: string; x: number; y: number } | null>(null);
  let movingPointerId = -1;
  let movingBoardId: string | null = null;
  let movingBoardIds: string[] = [];
  let movingBoardPositions: Array<{ id: string; x: number; y: number }> = [];
  let boardDragStarted = false;
  let boardWasSelected = false;
  let boardWasInSelection = false;
  let selectedBoardIds = $state.raw<Set<string>>(new Set());
  let movingReference: {
    id: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    referenceX: number;
    referenceY: number;
  } | null = null;
  let draggingGuide: { id: string; pointerId: number } | null = null;
  let dragPreview = $state.raw<Array<{ id: string; x: number; y: number }>>([]);
  let alignmentGuides = $state.raw<AlignmentGuide[]>([]);
  let movingBoardStart = { x: 0, y: 0, boardX: 0, boardY: 0 };
  let activeStrokeBoardId: string | null = null;
  let selectionDrag: {
    pointerId: number;
    boardId: string;
    start: PixelPos;
    points: PixelPos[];
    original: SelectionMask | null;
  } | null = null;
  let polygonPoints = $state<PixelPos[]>([]);
  let panStart = { x: 0, y: 0, offsetX: 0, offsetY: 0 };

  const touches = new Map<number, TouchPoint>();
  let gesture: PinchGesture | null = null;

  $effect(() => {
    if (selectionMode !== 'polygon') polygonPoints = [];
  });
  /** После жеста палец, оставшийся на экране, не должен рисовать. */
  let touchLocked = false;

  function makeContext(slot: ColorSlot, pressure = 1): ToolContext {
    return {
      buffer,
      color: slot === 'primary' ? primary : secondary,
      brushSize,
      brushShape,
      brushDefinition: brushDefinition ?? undefined,
      opacity: brushOpacity / 100,
      pressure,
      secondaryColor: slot === 'primary' ? secondary : primary,
      settings,
      sampleBuffer: settings.sampleMerged
        ? boards.find((board) => board.id === activeBoardId)?.buffer
        : undefined,
      invalidate: requestRender,
      setColor: (color) => onpickcolor(slot, color),
    };
  }

  const session = new StrokeSession({
    makeContext,
    onBegin: () => onstrokebegin(),
    onUseColor: (color) => onusecolor(color),
    onEnd: (outcome) => {
      onstrokeend(outcome);
      requestRender();
    },
  });

  // ——— Отрисовка: не чаще одного раза за кадр и только изменённая область ———

  /** Просит перерисовать холст в ближайшем кадре (вызывается и снаружи: bind:this). */
  export function requestRender(): void {
    onrender();
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderBoard(activeBoardId);
      renderTiledPreview();
      void updatePreviewWindow();
    });
  }

  function registerBoardCanvas(element: HTMLCanvasElement, id: string) {
    canvasElements.set(id, element);
    renderBoard(id);
    return {
      destroy() {
        canvasElements.delete(id);
        renderers.delete(id);
      },
    };
  }

  function registerReferenceCanvas(element: HTMLCanvasElement, reference: ReferenceImage) {
    let pixels: Uint8ClampedArray | null = null;
    function draw(next: ReferenceImage): void {
      if (pixels === next.pixels) return;
      element.width = next.width;
      element.height = next.height;
      const context = element.getContext('2d');
      if (!context) throw new Error('Не удалось создать контекст отображения референса.');
      context.imageSmoothingEnabled = false;
      context.putImageData(new ImageData(next.pixels, next.width, next.height), 0, 0);
      pixels = next.pixels;
    }
    draw(reference);
    return { update: draw };
  }

  function renderBoard(id: string): void {
    const board = boards.find((entry) => entry.id === id);
    const canvas = canvasElements.get(id);
    if (!board || !canvas) return;
    let entry = renderers.get(id);
    if (!entry || entry.canvas !== canvas) {
      entry = { canvas, buffer: board.buffer, renderer: new PixelRenderer(canvas) };
      renderers.set(id, entry);
      entry.renderer.attach(board.buffer);
    } else if (entry.buffer !== board.buffer) {
      entry.buffer = board.buffer;
      entry.renderer.attach(board.buffer);
    }
    entry.renderer.render();
  }

  $effect(() => {
    for (const board of boards) {
      void board.id;
      void board.buffer;
      renderBoard(board.id);
    }
  });

  // Автоматическое вписывание при смене активного холста или размеров сцены
  $effect(() => {
    void buffer.width;
    void buffer.height;
    void boards.length;
    untrack(() => {
      ensureFit();
    });
  });

  onDestroy(() => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
  });

  // ——— Вид ———

  /** Вписывает холст в область просмотра (вызывается и снаружи: bind:this). */
  export function fit(): void {
    const bounds = getSceneBounds();
    fittedSignature = boardSizeSignature();
    const fitted = fitView(bounds.width, bounds.height, viewW, viewH);
    view = {
      ...fitted,
      offsetX: fitted.offsetX - bounds.minX * fitted.zoom,
      offsetY: fitted.offsetY - bounds.minY * fitted.zoom,
    };
    updateCursor();
  }

  export function focusBoard(id: string): void {
    const board = boards.find((entry) => entry.id === id);
    if (!board) return;
    view = {
      ...centerView(view.zoom, board.buffer.width, board.buffer.height, viewW, viewH),
      offsetX: (viewW - board.buffer.width * view.zoom) / 2 - board.x * view.zoom,
      offsetY: (viewH - board.buffer.height * view.zoom) / 2 - board.y * view.zoom,
    };
  }

  export function centerActiveBoard(): void {
    const board = boards.find((entry) => entry.id === activeBoardId);
    if (!board) return;
    const centered = centerView(view.zoom, board.buffer.width, board.buffer.height, viewW, viewH);
    view = {
      ...centered,
      offsetX: centered.offsetX - board.x * view.zoom,
      offsetY: centered.offsetY - board.y * view.zoom,
    };
    updateCursor();
  }

  export function actualSize(): void {
    const board = boards.find((entry) => entry.id === activeBoardId);
    if (!board) return;
    const centered = centerView(1, board.buffer.width, board.buffer.height, viewW, viewH);
    view = {
      ...centered,
      offsetX: centered.offsetX - board.x,
      offsetY: centered.offsetY - board.y,
    };
    updateCursor();
  }

  /** Меняет зум на steps уровней вокруг центра области просмотра (кнопки и клавиши +/−). */
  export function zoomBy(steps: number): void {
    view = zoomAt(view, steps, viewW / 2, viewH / 2);
    updateCursor();
  }

  /** Вписывает холст, если его размер изменился с прошлого вписывания. */
  function ensureFit(): boolean {
    if (viewW === 0 || viewH === 0) return false;
    if (fittedSignature === boardSizeSignature()) return false;
    fit();
    return true;
  }

  function boardSizeSignature(): string {
    return `${buffer.width}x${buffer.height}`;
  }

  function geometryForBoard(board: Board): CanvasBoardGeometry {
    return {
      id: board.id,
      x: board.x,
      y: board.y,
      width: board.buffer.width,
      height: board.buffer.height,
    };
  }

  function getSceneBounds() {
    return getCanvasSceneBounds(
      boards.map(geometryForBoard),
      buffer.width,
      buffer.height,
    );
  }

  function boardAt(clientX: number, clientY: number): Board | null {
    const worldX = (clientX - originX - view.offsetX) / view.zoom;
    const worldY = (clientY - originY - view.offsetY) / view.zoom;
    return [...boards].reverse().find((board) =>
      worldX >= board.x && worldY >= board.y && worldX < board.x + board.buffer.width && worldY < board.y + board.buffer.height,
    ) ?? null;
  }

  function pixelAtBoard(board: Board, clientX: number, clientY: number): PixelPos {
    const point = pixelAt(clientX, clientY);
    return { x: point.x - board.x, y: point.y - board.y };
  }

  function selectionFromDrag(drag: NonNullable<typeof selectionDrag>, end: PixelPos): SelectionMask {
    if (selectionMode === 'ellipse') {
      return createEllipseSelection(buffer.width, buffer.height, drag.start.x, drag.start.y, end.x, end.y);
    }
    if (selectionMode === 'lasso') {
      const points = [...drag.points, end].filter((point, index, all) =>
        index === 0 || point.x !== all[index - 1]!.x || point.y !== all[index - 1]!.y,
      );
      return createPolygonSelection(buffer.width, buffer.height, points);
    }
    return createRectSelection(buffer.width, buffer.height, drag.start.x, drag.start.y, end.x, end.y);
  }

  function updateSelectionDrag(drag: NonNullable<typeof selectionDrag>, point: PixelPos): void {
    if (selectionMode === 'lasso') drag.points.push(point);
    const next = selectionFromDrag(drag, point);
    onselection(combineSelections(drag.original, next, selectionOperation));
  }

  function finishPolygonSelection(): void {
    if (polygonPoints.length < 3) return;
    const next = createPolygonSelection(buffer.width, buffer.height, polygonPoints);
    onselection(combineSelections(selectionMask, next, selectionOperation));
    polygonPoints = [];
  }

  function refreshOrigin(): void {
    if (!viewportEl) return;
    const rect = viewportEl.getBoundingClientRect();
    originX = rect.left;
    originY = rect.top;
  }

  /** Пиксель холста под экранной точкой; может лежать за границами холста. */
  function pixelAt(clientX: number, clientY: number): PixelPos {
    return screenToPixel(view, clientX - originX, clientY - originY);
  }

  function updateCursor(): void {
    const board = boards.find((entry) => entry.id === activeBoardId);
    const worldPoint = lastClient ? pixelAt(lastClient.x, lastClient.y) : null;
    const p = board && worldPoint ? { x: worldPoint.x - board.x, y: worldPoint.y - board.y } : null;
    if (!p || p.x < 0 || p.y < 0 || p.x >= buffer.width || p.y >= buffer.height) {
      if (cursor !== null) cursor = null;
      return;
    }
    if (cursor && cursor.x === p.x && cursor.y === p.y) return;
    cursor = p;
  }

  // ——— Колесо ———

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (!viewportEl) return;
    refreshOrigin();

    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 40;
    else if (e.deltaMode === 2) dy *= viewH;

    if (Math.sign(dy) !== Math.sign(wheelAcc)) wheelAcc = 0;
    wheelAcc += dy;

    const raw = Math.trunc(wheelAcc / WHEEL_STEP);
    if (raw === 0) return;
    wheelAcc = 0;
    const steps = Math.max(-MAX_WHEEL_STEPS, Math.min(MAX_WHEEL_STEPS, raw));

    // Удерживаем точку под курсором на месте, пока вокруг неё меняется масштаб.
    view = zoomAt(view, -steps, e.clientX - originX, e.clientY - originY);
    lastClient = { x: e.clientX, y: e.clientY };
    updateCursor();
  }

  // ——— Касания: два пальца — масштаб и перемещение ———

  function startGesture(): void {
    const nextGesture = beginPinchGesture(touches, originX, originY, view);
    if (!nextGesture) return;
    // Первый палец уже мог начать штрих: он отменяется целиком, чтобы не остаться случайной точке
    session.abortAny();
    gesture = nextGesture;
    touchLocked = true;
  }

  function updateGesture(): void {
    if (!gesture) return;
    const nextView = updatePinchGesture(gesture, touches, originX, originY);
    if (nextView) view = nextView;
  }

  function forgetTouch(pointerId: number): void {
    touches.delete(pointerId);
    if (gesture && gesture.ids.includes(pointerId)) gesture = null;
    if (touches.size === 0) touchLocked = false;
  }

  // ——— Указатель: мышь, перо, касание ———

  function onPointerDown(e: PointerEvent): void {
    if (!viewportEl || fillInProgress) return;
    if (boardContextMenu) boardContextMenu = null;
    refreshOrigin();
    keyboardCursorShown = false;

    const guideElement = e.target instanceof Element
      ? e.target.closest<HTMLElement>('[data-guide-id]')
      : null;
    const guideId = guideElement?.dataset.guideId;
    if (guideId && e.button === 0 && !session.isActive) {
      e.preventDefault();
      draggingGuide = { id: guideId, pointerId: e.pointerId };
      viewportEl.setPointerCapture(e.pointerId);
      return;
    }

    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2) {
        if (!gesture) startGesture();
        return;
      }
      if (touchLocked) return;
    }

    const worldPoint = pixelAt(e.clientX, e.clientY);
    const reference = referenceAtPoint(references, worldPoint.x, worldPoint.y);
    const picker = temporaryPicker || e.altKey || tool.id === 'picker';
    const colorSlot: ColorSlot | null = e.button === 0
      ? e.shiftKey && secondaryColorDrawing ? 'secondary' : 'primary'
      : e.button === 2 ? 'secondary' : null;
    if (reference && picker && colorSlot) {
      e.preventDefault();
      const color = sampleReferenceColor(reference, worldPoint.x, worldPoint.y);
      if (color) onpickcolor(colorSlot, color);
      return;
    }
    if (reference && e.button === 0 && !panMode && !selectionMode && !picker && !reference.locked) {
      e.preventDefault();
      onreferencemovestart();
      onselectreference(reference.id);
      movingReference = {
        id: reference.id,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        referenceX: reference.x,
        referenceY: reference.y,
      };
      viewportEl.setPointerCapture(e.pointerId);
      return;
    }

    const board = boardAt(e.clientX, e.clientY);
    if (e.button === 0 && !board && selectedBoardIds.size > 0) {
      selectedBoardIds = new Set();
    }

    if (e.button === 2 && e.ctrlKey && board) {
      if (session.isActive) return;
      e.preventDefault();
      boardWasInSelection = selectedBoardIds.has(board.id);
      boardWasSelected = boardWasInSelection || board.id === activeBoardId;
      onselectboard(board.id);
      movingBoardIds = boardWasInSelection
        ? [...selectedBoardIds]
        : boardWasSelected && selectedBoardIds.size > 0
          ? [...selectedBoardIds, board.id]
          : [board.id];
      movingBoardPositions = boards
        .filter((entry) => movingBoardIds.includes(entry.id))
        .map((entry) => ({ id: entry.id, x: entry.x, y: entry.y }));
      movingBoardId = board.id;
      movingPointerId = e.pointerId;
      movingBoardStart = { x: e.clientX, y: e.clientY, boardX: board.x, boardY: board.y };
      boardDragStarted = false;
      dragPreview = [];
      viewportEl.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button === 2) {
      if (panning || session.isActive) return;
      e.preventDefault();
      rightPanPointerId = e.pointerId;
      rightClickBoardId = board?.id === activeBoardId ? board.id : null;
      panStart = { x: e.clientX, y: e.clientY, offsetX: view.offsetX, offsetY: view.offsetY };
      viewportEl.focus({ preventScroll: true });
      viewportEl.setPointerCapture(e.pointerId);
      return;
    }

    // Панорамирование: пробел + левая кнопка или средняя кнопка
    if (e.button === 1 || (e.button === 0 && panMode)) {
      if (panning || session.isActive) return;
      e.preventDefault();
      panning = true;
      panPointerId = e.pointerId;
      panStart = { x: e.clientX, y: e.clientY, offsetX: view.offsetX, offsetY: view.offsetY };
      viewportEl.setPointerCapture(e.pointerId);
      return;
    }

    // Рисование: левая кнопка (касание и перо тоже считаются левой).
    if (panning || session.isActive || panMode || previewBuffer) return;
    if (!board || board.id !== activeBoardId) return;
    if (selectionMode && e.button === 0) {
      e.preventDefault();
      viewportEl.focus({ preventScroll: true });
      viewportEl.setPointerCapture(e.pointerId);
      const point = pixelAtBoard(board, e.clientX, e.clientY);
      if (selectionMode === 'wand' || selectionMode === 'color') {
        const sampleBuffer = settings.sampleMerged ? board.buffer : buffer;
        const next = createColorSelection(sampleBuffer, point.x, point.y, {
          tolerance: settings.fillTolerance,
          connectivity: settings.fillConnectivity,
          contiguous: selectionMode === 'wand',
        });
        onselection(combineSelections(selectionMask, next, selectionOperation));
        releasePointer(e.pointerId);
        return;
      }
      if (selectionMode === 'polygon') {
        const previous = polygonPoints.at(-1);
        if (!previous || previous.x !== point.x || previous.y !== point.y) polygonPoints = [...polygonPoints, point];
        if (e.detail >= 2) finishPolygonSelection();
        releasePointer(e.pointerId);
        return;
      }
      selectionDrag = {
        pointerId: e.pointerId,
        boardId: board.id,
        start: point,
        points: [point],
        original: selectionMask,
      };
      updateSelectionDrag(selectionDrag, point);
      return;
    }
    const slot: ColorSlot | null = e.button === 0
      ? e.shiftKey && secondaryColorDrawing ? 'secondary' : 'primary'
      : null;
    if (slot === null) return;

    e.preventDefault();
    viewportEl.focus({ preventScroll: true });
    viewportEl.setPointerCapture(e.pointerId);
    const p = pixelAtBoard(board, e.clientX, e.clientY);
    const activeTool = temporaryPicker || e.altKey ? getTool('picker') : tool;
    if (activeTool.id === 'fill') {
      onfill(p.x, p.y, slot);
      return;
    }
    activeStrokeBoardId = board.id;
    session.start(e.pointerId, activeTool, slot, p.x, p.y, e.pointerType === 'pen' ? e.pressure : 1);
  }

  function onPointerMove(e: PointerEvent): void {
    lastClient = { x: e.clientX, y: e.clientY };

    if (movingReference?.pointerId === e.pointerId) {
      onreferencemove(
        movingReference.id,
        movingReference.referenceX + (e.clientX - movingReference.startClientX) / view.zoom,
        movingReference.referenceY + (e.clientY - movingReference.startClientY) / view.zoom,
      );
      return;
    }

    if (draggingGuide?.pointerId === e.pointerId) {
      const guide = guides.find((entry) => entry.id === draggingGuide?.id);
      const board = guide && boards.find((entry) => entry.id === guide.boardId);
      if (guide && board) {
        const point = pixelAtBoard(board, e.clientX, e.clientY);
        const position = guide.axis === 'x'
          ? Math.max(0, Math.min(board.buffer.width, point.x))
          : Math.max(0, Math.min(board.buffer.height, point.y));
        onguideschange(guides.map((entry) => entry.id === guide.id ? { ...entry, position } : entry));
      }
      return;
    }

    if (e.pointerType === 'touch') {
      const known = touches.get(e.pointerId);
      if (known) {
        known.x = e.clientX;
        known.y = e.clientY;
      }
      if (gesture) {
        if (gesture.ids.includes(e.pointerId)) updateGesture();
        return;
      }
    }

    if (movingBoardId !== null && movingPointerId === e.pointerId) {
      if (!boardDragStarted && Math.hypot(e.clientX - movingBoardStart.x, e.clientY - movingBoardStart.y) >= 4) {
        boardDragStarted = true;
        if (!boardWasSelected) selectedBoardIds = new Set([movingBoardId]);
        else if (!boardWasInSelection) selectedBoardIds = new Set([...selectedBoardIds, movingBoardId]);
      }
      if (boardDragStarted && !boardWasSelected) {
        dragPreview = [];
        alignmentGuides = [];
        updateCursor();
        return;
      }
      if (boardDragStarted) {
        const dx = Math.round((e.clientX - movingBoardStart.x) / view.zoom);
        const dy = Math.round((e.clientY - movingBoardStart.y) / view.zoom);
        const movingBoard = boards.find((entry) => entry.id === movingBoardId);
        const initialPosition = movingBoardPositions.find((entry) => entry.id === movingBoardId);
        if (!movingBoard || !initialPosition) return;
        const snapped = snapCanvasBoardPosition(
          geometryForBoard(movingBoard),
          boards.map(geometryForBoard),
          initialPosition.x + dx,
          initialPosition.y + dy,
          view.zoom,
          snapToGrid,
          gridSpacing,
          new Set(movingBoardIds),
        );
        const offsetX = snapped.x - initialPosition.x;
        const offsetY = snapped.y - initialPosition.y;
        dragPreview = movingBoardPositions.map((entry) => ({
          id: entry.id,
          x: entry.x + offsetX,
          y: entry.y + offsetY,
        }));
        alignmentGuides = snapped.guides;
      }
      updateCursor();
      return;
    }

    if (selectionDrag?.pointerId === e.pointerId) {
      const board = boards.find((entry) => entry.id === selectionDrag?.boardId);
      if (board) updateSelectionDrag(selectionDrag, pixelAtBoard(board, e.clientX, e.clientY));
      updateCursor();
      return;
    }

    if (
      rightPanPointerId === e.pointerId &&
      !panning &&
      Math.hypot(e.clientX - panStart.x, e.clientY - panStart.y) >= 4
    ) {
      panning = true;
      panPointerId = e.pointerId;
    }

    if (panning && e.pointerId === panPointerId) {
      view = {
        zoom: view.zoom,
        offsetX: Math.round(panStart.offsetX + (e.clientX - panStart.x)),
        offsetY: Math.round(panStart.offsetY + (e.clientY - panStart.y)),
      };
    } else if (session.isActiveFor(e.pointerId)) {
      // Объединённые события дают все промежуточные позиции быстрого движения;
      // оставшиеся разрывы закрывает Брезенхэм внутри инструмента
      const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const events = coalesced.length > 0 ? coalesced : [e];
      const board = activeStrokeBoardId
        ? boards.find((entry) => entry.id === activeStrokeBoardId)
        : undefined;
      if (board) {
        session.move(
          e.pointerId,
          events.map((event) => ({
            ...pixelAtBoard(board, event.clientX, event.clientY),
            pressure: event.pointerType === 'pen' ? event.pressure : 1,
          })),
        );
      }
    }

    updateCursor();
  }

  function releasePointer(pointerId: number): void {
    if (viewportEl?.hasPointerCapture(pointerId)) viewportEl.releasePointerCapture(pointerId);
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.pointerType === 'touch') forgetTouch(e.pointerId);

    if (movingReference?.pointerId === e.pointerId) {
      movingReference = null;
      onreferencemoveend();
      releasePointer(e.pointerId);
      return;
    }

    if (draggingGuide?.pointerId === e.pointerId) {
      draggingGuide = null;
      releasePointer(e.pointerId);
      return;
    }

    if (movingBoardId !== null && movingPointerId === e.pointerId) {
      const movedId = movingBoardId;
      const previews = dragPreview;
      const didDrag = boardDragStarted;
      if (!didDrag) {
        const nextSelection = new Set(selectedBoardIds);
        if (boardWasInSelection) nextSelection.delete(movedId);
        else nextSelection.add(movedId);
        selectedBoardIds = nextSelection;
      }
      movingBoardId = null;
      movingPointerId = -1;
      movingBoardIds = [];
      movingBoardPositions = [];
      boardDragStarted = false;
      boardWasSelected = false;
      boardWasInSelection = false;
      dragPreview = [];
      alignmentGuides = [];
      if (didDrag && previews.length === 1) {
        const preview = previews[0]!;
        onmoveboard(preview.id, preview.x, preview.y);
      } else if (didDrag && previews.length > 1) {
        onmoveboards(previews);
      }
      releasePointer(e.pointerId);
      return;
    }

    if (selectionDrag?.pointerId === e.pointerId) {
      const drag = selectionDrag;
      const board = boards.find((entry) => entry.id === drag.boardId);
      if (board) updateSelectionDrag(drag, pixelAtBoard(board, e.clientX, e.clientY));
      selectionDrag = null;
      releasePointer(e.pointerId);
      return;
    }

    if (rightPanPointerId === e.pointerId) {
      const clickedBoardId = rightClickBoardId;
      rightClickBoardId = null;
      rightPanPointerId = -1;
      if (!panning && clickedBoardId === activeBoardId && boardAt(e.clientX, e.clientY)?.id === clickedBoardId) {
        const rect = viewportEl!.getBoundingClientRect();
        const menuWidth = 212;
        const menuHeight = 82;
        boardContextMenu = {
          boardId: clickedBoardId,
          x: Math.max(8, Math.min(e.clientX - rect.left, rect.width - menuWidth - 8)),
          y: Math.max(8, Math.min(e.clientY - rect.top, rect.height - menuHeight - 8)),
        };
      }
    }

    if (panning && e.pointerId === panPointerId) {
      panning = false;
      panPointerId = -1;
      releasePointer(e.pointerId);
    }
    if (session.isActiveFor(e.pointerId)) {
      const board = activeStrokeBoardId ? boards.find((entry) => entry.id === activeStrokeBoardId) : undefined;
      if (board) {
        session.finish(e.pointerId, {
          ...pixelAtBoard(board, e.clientX, e.clientY),
          pressure: e.pointerType === 'pen' ? e.pressure : 1,
        });
      }
      activeStrokeBoardId = null;
      releasePointer(e.pointerId);
    }
    updateCursor();
  }

  /** Браузер забрал ввод (системный жест, ладонь на экране): штрих отменяется целиком. */
  function onPointerCancel(e: PointerEvent): void {
    if (e.pointerType === 'touch') forgetTouch(e.pointerId);
    if (movingReference?.pointerId === e.pointerId) {
      movingReference = null;
      onreferencemovecancel();
      releasePointer(e.pointerId);
    }
    if (draggingGuide?.pointerId === e.pointerId) {
      draggingGuide = null;
      releasePointer(e.pointerId);
    }
    if (rightPanPointerId === e.pointerId) {
      rightPanPointerId = -1;
      rightClickBoardId = null;
    }
    if (selectionDrag?.pointerId === e.pointerId) {
      onselection(selectionDrag.original);
      selectionDrag = null;
      releasePointer(e.pointerId);
    }
    if (movingBoardId !== null && movingPointerId === e.pointerId) {
      movingBoardId = null;
      movingPointerId = -1;
      movingBoardIds = [];
      movingBoardPositions = [];
      boardDragStarted = false;
      boardWasSelected = false;
      boardWasInSelection = false;
      dragPreview = [];
      alignmentGuides = [];
    }

    if (panning && e.pointerId === panPointerId) {
      panning = false;
      panPointerId = -1;
      releasePointer(e.pointerId);
    }
    if (session.isActiveFor(e.pointerId)) {
      session.abort(e.pointerId);
      activeStrokeBoardId = null;
      releasePointer(e.pointerId);
    }
  }

  /**
   * Захват потерян без pointerup (окно потеряло фокус, отпускание указателя произошло вне окна):
   * без этого штрих «залипал» бы и блокировал рисование до перезагрузки страницы.
   */
  function onLostPointerCapture(e: PointerEvent): void {
    if (movingReference?.pointerId === e.pointerId) {
      movingReference = null;
      onreferencemovecancel();
    }
    if (draggingGuide?.pointerId === e.pointerId) draggingGuide = null;
    if (rightPanPointerId === e.pointerId) {
      rightPanPointerId = -1;
      rightClickBoardId = null;
    }
    if (selectionDrag?.pointerId === e.pointerId) {
      onselection(selectionDrag.original);
      selectionDrag = null;
    }
    if (movingBoardId !== null && movingPointerId === e.pointerId) {
      movingBoardId = null;
      movingPointerId = -1;
      movingBoardIds = [];
      movingBoardPositions = [];
      boardDragStarted = false;
      boardWasSelected = false;
      boardWasInSelection = false;
      dragPreview = [];
      alignmentGuides = [];
    }
    if (panning && e.pointerId === panPointerId) {
      panning = false;
      panPointerId = -1;
    }
    if (session.isActiveFor(e.pointerId)) {
      session.finish(e.pointerId);
      activeStrokeBoardId = null;
    }
  }

  function onPointerLeave(): void {
    if (panning || session.isActive) return;
    lastClient = null;
    cursor = null;
  }

  // ——— Клавиатура: курсор на холсте, Enter — начать/закончить штрих ———

  function showKeyboardCursor(): void {
    if (keyboardCursorShown) return;
    const start = cursor ?? { x: buffer.width >> 1, y: buffer.height >> 1 };
    keyboardX = Math.min(buffer.width - 1, Math.max(0, start.x));
    keyboardY = Math.min(buffer.height - 1, Math.max(0, start.y));
    keyboardCursorShown = true;
  }

  function moveKeyboardCursor(dx: number, dy: number): void {
    keyboardX = Math.min(buffer.width - 1, Math.max(0, keyboardX + dx));
    keyboardY = Math.min(buffer.height - 1, Math.max(0, keyboardY + dy));
    cursor = { x: keyboardX, y: keyboardY };
    const board = boards.find((entry) => entry.id === activeBoardId);
    if (board) {
      view = ensurePixelVisible(view, board.x + keyboardX, board.y + keyboardY, viewW, viewH);
    }
    if (session.isActiveFor('keyboard')) session.move('keyboard', [{ x: keyboardX, y: keyboardY }]);
  }

  function toggleKeyboardStroke(slot: ColorSlot): void {
    const here = { x: keyboardX, y: keyboardY };
    if (tool.id === 'fill') {
      onfill(here.x, here.y, slot);
      return;
    }
    if (session.isActiveFor('keyboard')) {
      session.finish('keyboard', here);
      keyboardPenDown = false;
      return;
    }
    if (!session.start('keyboard', tool, slot, here.x, here.y)) return;
    // Инструменты без движения (заливка) срабатывают сразу
    if (tool.move) keyboardPenDown = true;
    else session.finish('keyboard', here);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (boardContextMenu && e.key === 'Escape') {
      e.preventDefault();
      boardContextMenu = null;
      return;
    }
    if (fillInProgress) {
      e.preventDefault();
      return;
    }
    if (selectionMode === 'polygon' && e.key === 'Enter') {
      e.preventDefault();
      finishPolygonSelection();
      return;
    }
    if (selectionMode === 'polygon' && e.key === 'Escape' && polygonPoints.length > 0) {
      e.preventDefault();
      polygonPoints = [];
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const arrow = ARROWS[e.key];
    if (arrow) {
      e.preventDefault();
      showKeyboardCursor();
      const step = e.shiftKey ? KEYBOARD_BIG_STEP : 1;
      moveKeyboardCursor(arrow[0] * step, arrow[1] * step);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      showKeyboardCursor();
      cursor = { x: keyboardX, y: keyboardY };
      toggleKeyboardStroke(e.shiftKey ? 'secondary' : 'primary');
      return;
    }

    if (e.key === 'Escape' && session.isActiveFor('keyboard')) {
      e.preventDefault();
      session.abort('keyboard');
      keyboardPenDown = false;
    }
  }

  function onFocus(): void {
    focused = true;
  }

  function onBlur(): void {
    focused = false;
    if (movingReference) {
      movingReference = null;
      onreferencemovecancel();
    }
    movingReference = null;
    if (session.isActiveFor('keyboard')) {
      session.finish('keyboard');
      keyboardPenDown = false;
    }
  }

  onMount(() => {
    const el = viewportEl;
    if (!el) return;
    const dismissBoardContextMenu = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.board-context-menu')) return;
      if (boardContextMenu) boardContextMenu = null;
    };

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      viewW = rect.width;
      viewH = rect.height;
      refreshOrigin();
      ensureFit();
    });
    observer.observe(el);

    // passive: false нужен, чтобы колесо не прокручивало страницу
    el.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('pointerdown', dismissBoardContextMenu, true);

    return () => {
      observer.disconnect();
      el.removeEventListener('wheel', onWheel);
      document.removeEventListener('pointerdown', dismissBoardContextMenu, true);
      if (tiledRenderFrame) cancelAnimationFrame(tiledRenderFrame);
      if (previewWindowTimer) clearInterval(previewWindowTimer);
      previewWindow?.close();
    };
  });
</script>

<!-- Поле холстов само обрабатывает клавиатуру и указатель -->
<div class="canvas-shell">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="viewport"
    class:pan={panMode}
    class:panning
    style:background={workspaceBackground}
    bind:this={viewportEl}
    role="application"
    tabindex="0"
    aria-label="Рабочее поле. Перетаскивайте пустое пространство правой кнопкой мыши, чтобы перемещаться. Ctrl и клик правой кнопкой выделяют холсты; перетаскивание выделенного холста перемещает группу."
    oncontextmenu={(e) => e.preventDefault()}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerCancel}
    onlostpointercapture={onLostPointerCapture}
    onpointerleave={onPointerLeave}
    onkeydown={onKeyDown}
    onfocus={onFocus}
    onblur={onBlur}
  >
    {#if tiledMode}
      <canvas class="tiled-background" bind:this={tiledPreviewCanvas} aria-hidden="true"></canvas>
    {/if}
    <div
      class="stage"
      style:transform="translate({view.offsetX}px, {view.offsetY}px)"
    >
      {#each boards as board (board.id)}
        <div
          class="board"
          class:selected={board.id === activeBoardId}
          class:group-selected={selectedBoardIds.has(board.id) && board.id !== activeBoardId}
          class:checkerboard={checkerboard}
          class:zoomed-out={view.zoom < 1}
          style:left="{board.x * view.zoom}px"
          style:top="{board.y * view.zoom}px"
          style:width="{board.buffer.width * view.zoom}px"
          style:height="{board.buffer.height * view.zoom}px"
          style:background-color={canvasBackground}
        >
          <canvas
            use:registerBoardCanvas={board.id}
            style:display={board.id === activeBoardId && previewBuffer ? 'none' : 'block'}
          ></canvas>
          {#if showGrid && view.zoom * (gridMode === 'pixel' ? 1 : gridSpacing) >= GRID_MIN_ZOOM}
            <div
              class="grid"
              class:pixel-grid={gridMode === 'pixel'}
              class:square-grid={gridMode === 'square'}
              class:isometric-grid={gridMode === 'isometric'}
              style:--grid-size="{(gridMode === 'pixel' ? 1 : gridSpacing) * view.zoom}px"
            ></div>
          {/if}
          <canvas
            use:registerTransformPreviewCanvas={board.id}
            class="transform-preview"
            style:display={board.id === activeBoardId && previewBuffer ? 'block' : 'none'}
            aria-hidden="true"
          ></canvas>
          <canvas
            use:registerSelectionCanvas={board.id}
            class="selection-overlay"
            aria-hidden="true"
            style:display={board.id === activeBoardId && (previewSelection || selectionMask) ? 'block' : 'none'}
          ></canvas>
          {#if board.id === activeBoardId && selectionMode === 'polygon' && polygonPoints.length > 0}
            <svg class="selection-draft" viewBox="0 0 {board.buffer.width} {board.buffer.height}" aria-hidden="true">
              <polyline points={polygonPoints.map((point) => `${point.x + 0.5},${point.y + 0.5}`).join(' ')} />
            </svg>
          {/if}
          {#each guides.filter((guide) => guide.boardId === board.id) as guide (guide.id)}
            <div
              class="user-guide"
              class:vertical={guide.axis === 'x'}
              class:horizontal={guide.axis === 'y'}
              data-guide-id={guide.id}
              style:left={guide.axis === 'x' ? `${guide.position * view.zoom}px` : undefined}
              style:top={guide.axis === 'y' ? `${guide.position * view.zoom}px` : undefined}
              title="Перетащите направляющую, чтобы переместить"
            ></div>
          {/each}
          {#if board.id === activeBoardId && symmetryX}
            <div class="symmetry-guide vertical" aria-label="Вертикальная ось симметрии" style:left="{board.buffer.width * view.zoom / 2}px"></div>
          {/if}
          {#if board.id === activeBoardId && symmetryY}
            <div class="symmetry-guide horizontal" aria-label="Горизонтальная ось симметрии" style:top="{board.buffer.height * view.zoom / 2}px"></div>
          {/if}
        </div>
      {/each}
      {#each references.filter((reference) => reference.visible) as reference (reference.id)}
        <canvas
          use:registerReferenceCanvas={reference}
          class="reference-image"
          class:selected={reference.id === selectedReferenceId}
          style:left="{reference.x * view.zoom}px"
          style:top="{reference.y * view.zoom}px"
          style:width="{reference.width * reference.scale * view.zoom}px"
          style:height="{reference.height * reference.scale * view.zoom}px"
          style:transform="rotate({reference.rotation}deg)"
          style:opacity={reference.opacity}
          aria-label="Референс: {reference.name}"
        ></canvas>
      {/each}
      {#if cursor && tool.usesBrush}
        {@const activeBoard = boards.find((board) => board.id === activeBoardId)}
        {#if activeBoard}
          <div
            class="brush-cursor"
            class:circle={brushShape === 'circle'}
            style:left="{(activeBoard.x + cursor.x - Math.floor((brushSize - 1) / 2)) * view.zoom}px"
            style:top="{(activeBoard.y + cursor.y - Math.floor((brushSize - 1) / 2)) * view.zoom}px"
            style:width="{brushSize * view.zoom}px"
            style:height="{brushSize * view.zoom}px"
            aria-hidden="true"
          ></div>
        {/if}
      {/if}
      {#each dragPreview as preview (preview.id)}
        {@const previewBoard = boards.find((board) => board.id === preview.id)}
        {#if previewBoard && (previewBoard.x !== preview.x || previewBoard.y !== preview.y)}
          <div
            class="drop-preview"
            style:left="{preview.x * view.zoom}px"
            style:top="{preview.y * view.zoom}px"
            style:width="{previewBoard.buffer.width * view.zoom}px"
            style:height="{previewBoard.buffer.height * view.zoom}px"
            aria-hidden="true"
          ></div>
        {/if}
      {/each}
      {#each alignmentGuides as guide, index (`${guide.x1}:${guide.y1}:${guide.x2}:${guide.y2}:${index}`)}
        {@const box = getAlignmentGuideBox(guide, view.zoom)}
        {@const line = getAlignmentGuideLine(guide, view.zoom)}
        <svg
          class="alignment-guide"
          style:left="{box.left}px"
          style:top="{box.top}px"
          width={box.width}
          height={box.height}
          aria-hidden="true"
        >
          <line
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke="#39a9ff"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        </svg>
      {/each}
      {#if focused && keyboardCursorShown}
        {@const activeBoard = boards.find((board) => board.id === activeBoardId)}
        <div
          class="kcursor"
          class:down={keyboardPenDown}
          style:left="{((activeBoard?.x ?? 0) + keyboardX) * view.zoom}px"
          style:top="{((activeBoard?.y ?? 0) + keyboardY) * view.zoom}px"
          style:width="{view.zoom}px"
          style:height="{view.zoom}px"
        ></div>
      {/if}
    </div>
    {#if previewBuffer}
      <div class="transform-preview-controls" role="group" aria-label="Подтверждение трансформации">
        <span>Предпросмотр трансформации</span>
        <button type="button" class="confirm" onclick={onconfirmtransform}>Применить</button>
        <button type="button" onclick={oncanceltransform}>Отмена</button>
      </div>
    {/if}
    {#if boardContextMenu}
      <div
        class="board-context-menu"
        role="group"
        aria-label="Действия холста"
        style:left="{boardContextMenu.x}px"
        style:top="{boardContextMenu.y}px"
        onpointerdown={(event) => event.stopPropagation()}
        onpointerup={(event) => event.stopPropagation()}
        oncontextmenu={(event) => event.preventDefault()}
      >
        <button
          type="button"
          onclick={() => {
            const boardId = boardContextMenu?.boardId;
            boardContextMenu = null;
            if (boardId) ondeleteboard(boardId);
          }}
        >Удалить</button>
        <button
          type="button"
          onclick={() => {
            const boardId = boardContextMenu?.boardId;
            boardContextMenu = null;
            if (boardId) onfitboard(boardId);
          }}
        >Подогнать холст под изображение</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .canvas-shell {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .viewport {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: #34363f;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    cursor: crosshair;
  }

  .viewport:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .viewport.pan {
    cursor: grab;
  }

  .viewport.panning {
    cursor: grabbing;
  }

  .board-context-menu {
    position: absolute;
    z-index: 30;
    display: grid;
    min-width: 196px;
    gap: 4px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    color: var(--text);
  }

  .board-context-menu button {
    min-height: 30px;
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .board-context-menu button:hover,
  .board-context-menu button:focus-visible {
    border-color: var(--border);
    background: var(--panel-2);
    outline: none;
  }

  .stage {
    position: absolute;
    left: 0;
    top: 0;
    will-change: transform;
  }

  .tiled-background {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    image-rendering: pixelated;
  }

  .board {
    position: absolute;
    background-color: #fff;
    box-shadow:
      0 0 0 1px #4a4e60,
      0 12px 40px rgba(0, 0, 0, 0.55);
  }

  .reference-image {
    position: absolute;
    z-index: 3;
    max-width: none;
    transform-origin: center center;
    image-rendering: pixelated;
    pointer-events: none;
  }

  .reference-image.selected {
    outline: 1px dashed #fff;
    outline-offset: -1px;
  }

  .board.checkerboard {
    background-image:
      linear-gradient(45deg, #c9cbd1 25%, transparent 25%),
      linear-gradient(-45deg, #c9cbd1 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #c9cbd1 75%),
      linear-gradient(-45deg, transparent 75%, #c9cbd1 75%);
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    background-size: 16px 16px;
  }

  .board.selected {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .board.group-selected {
    outline: 2px dashed var(--accent);
    outline-offset: 3px;
  }

  .drop-preview {
    position: absolute;
    box-sizing: border-box;
    border: 2px dashed var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    pointer-events: none;
  }

  .alignment-guide {
    position: absolute;
    overflow: visible;
    pointer-events: none;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
  }

  .board.zoomed-out canvas {
    image-rendering: auto;
  }

  .grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(to right, rgba(150, 155, 175, 0.4) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(150, 155, 175, 0.4) 1px, transparent 1px);
    background-size: var(--grid-size) var(--grid-size);
  }

  .grid.isometric-grid {
    background-image:
      repeating-linear-gradient(30deg, rgba(150, 155, 175, 0.4) 0 1px, transparent 1px var(--grid-size)),
      repeating-linear-gradient(90deg, rgba(150, 155, 175, 0.4) 0 1px, transparent 1px var(--grid-size)),
      repeating-linear-gradient(150deg, rgba(150, 155, 175, 0.4) 0 1px, transparent 1px var(--grid-size));
  }

  .grid.pixel-grid,
  .grid.square-grid {
    background-size: var(--grid-size) var(--grid-size);
  }

  .user-guide,
  .symmetry-guide {
    position: absolute;
    z-index: 8;
    pointer-events: none;
  }

  .user-guide {
    pointer-events: auto;
    touch-action: none;
  }

  .user-guide.vertical,
  .symmetry-guide.vertical {
    top: 0;
    bottom: 0;
    width: 9px;
    transform: translateX(-50%);
    cursor: ew-resize;
  }

  .user-guide.horizontal,
  .symmetry-guide.horizontal {
    left: 0;
    right: 0;
    height: 9px;
    transform: translateY(-50%);
    cursor: ns-resize;
  }

  .user-guide::after,
  .symmetry-guide::after {
    position: absolute;
    content: '';
    background: #35c9ff;
    opacity: 0.9;
    box-shadow: 0 0 2px #00131d;
  }

  .user-guide.vertical::after,
  .symmetry-guide.vertical::after {
    top: 0;
    bottom: 0;
    left: 4px;
    width: 1px;
  }

  .user-guide.horizontal::after,
  .symmetry-guide.horizontal::after {
    top: 4px;
    right: 0;
    left: 0;
    height: 1px;
  }

  .symmetry-guide {
    z-index: 7;
  }

  .symmetry-guide::after {
    background: #ff6b92;
    opacity: 0.8;
  }

  .selection-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    image-rendering: pixelated;
  }

  .selection-draft {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }

  .selection-draft polyline {
    fill: color-mix(in srgb, var(--accent) 18%, transparent);
    stroke: var(--accent);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  .transform-preview {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    image-rendering: pixelated;
  }

  .transform-preview-controls {
    position: absolute;
    z-index: 20;
    right: 12px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    color: var(--text);
    font-size: 12px;
  }

  .transform-preview-controls button {
    min-height: 30px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .transform-preview-controls .confirm {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--bg);
  }

  .brush-cursor {
    position: absolute;
    z-index: 4;
    box-sizing: border-box;
    border: 1px solid #fff;
    outline: 1px solid #000;
    pointer-events: none;
  }

  .brush-cursor.circle {
    border-radius: 50%;
  }

  .kcursor {
    position: absolute;
    min-width: 6px;
    min-height: 6px;
    box-sizing: border-box;
    border: 2px solid #fff;
    box-shadow:
      0 0 0 1px #000,
      inset 0 0 0 1px #000;
    pointer-events: none;
  }

  .kcursor.down {
    border-color: var(--accent);
    background: rgba(124, 92, 255, 0.35);
  }
</style>
