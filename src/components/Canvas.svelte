<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { ColorSlot } from '../core/palette';
  import { PixelRenderer } from '../core/render';
  import type { PixelBuffer, RGBA } from '../core/state';
  import { StrokeSession, type StrokeOutcome } from '../core/stroke';
  import type { Tool, ToolContext } from '../core/tools';
  import {
    centerView,
    ensurePixelVisible,
    fitView,
    nearestZoomLevel,
    screenToPixel,
    zoomAt,
    type PixelPos,
    type ViewState,
  } from '../core/viewport';

  interface Board {
    id: string;
    x: number;
    y: number;
    buffer: PixelBuffer;
  }

  interface AlignmentGuide {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  interface Props {
    buffer: PixelBuffer;
    boards: readonly Board[];
    activeBoardId: string;
    view: ViewState;
    cursor: PixelPos | null;
    showGrid: boolean;
    panMode: boolean;
    canvasBackground: string;
    workspaceBackground: string;
    tool: Tool;
    /** Основной цвет (левая кнопка) и дополнительный (правая). */
    primary: RGBA;
    secondary: RGBA;
    brushSize: number;
    /** Пипетка выбрала цвет для слота. */
    onpickcolor: (slot: ColorSlot, color: RGBA) => void;
    /** Штрих начат этим цветом (для списка недавних). */
    onusecolor: (color: RGBA) => void;
    /** Перед первым изменением штриха (история запоминает исходное состояние). */
    onstrokebegin: () => void;
    /** После штриха: commit — записать в историю, rollback — откатить целиком. */
    onstrokeend: (outcome: StrokeOutcome) => void;
    onselectboard: (id: string) => void;
    onmoveboard: (id: string, x: number, y: number) => void;
  }

  let {
    buffer,
    boards,
    activeBoardId,
    view = $bindable(),
    cursor = $bindable(),
    showGrid,
    panMode,
    canvasBackground,
    workspaceBackground,
    tool,
    primary,
    secondary,
    brushSize,
    onpickcolor,
    onusecolor,
    onstrokebegin,
    onstrokeend,
    onselectboard,
    onmoveboard,
  }: Props = $props();

  /** Ниже этого зума линии сетки слишком частые и не рисуются. */
  const GRID_MIN_ZOOM = 4;
  const HORIZONTAL_SCROLL_RANGE = 1000;
  const ALIGNMENT_SNAP_DISTANCE = 8;
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

  interface Gesture {
    ids: [number, number];
    startDistance: number;
    startZoom: number;
    startMidX: number;
    startMidY: number;
    startOffsetX: number;
    startOffsetY: number;
  }

  let viewportEl: HTMLDivElement | undefined = $state();
  let horizontalScrollEl: HTMLDivElement | undefined = $state();
  let panning = $state(false);
  let focused = $state(false);
  let keyboardCursorShown = $state(false);
  let keyboardX = $state(0);
  let keyboardY = $state(0);
  let keyboardPenDown = $state(false);

  const renderers = new Map<string, { canvas: HTMLCanvasElement; buffer: PixelBuffer; renderer: PixelRenderer }>();
  const canvasElements = new Map<string, HTMLCanvasElement>();
  let frame = 0;

  let viewW = 0;
  let viewH = 0;
  let originX = 0;
  let originY = 0;
  let fittedSignature = '';
  let wheelAcc = 0;
  let lastClient: { x: number; y: number } | null = null;
  let panPointerId = -1;
  let rightPanPointerId = -1;
  let movingPointerId = -1;
  let movingBoardId: string | null = null;
  let dragPreview = $state.raw<{ id: string; x: number; y: number } | null>(null);
  let alignmentGuides = $state.raw<AlignmentGuide[]>([]);
  let movingBoardStart = { x: 0, y: 0, boardX: 0, boardY: 0 };
  let rightClickBoardId: string | null = null;
  let activeStrokeBoardId: string | null = null;
  let panStart = { x: 0, y: 0, offsetX: 0, offsetY: 0 };

  const touches = new Map<number, { x: number; y: number }>();
  let gesture: Gesture | null = null;
  const sceneBounds = $derived(getSceneBounds());
  const horizontalScroll = $derived(getHorizontalScrollMetrics());
  /** После жеста палец, оставшийся на экране, не должен рисовать. */
  let touchLocked = false;

  function makeContext(slot: ColorSlot): ToolContext {
    return {
      buffer,
      color: slot === 'primary' ? primary : secondary,
      brushSize,
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
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderBoard(activeBoardId);
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
    view = clampSceneView({
      ...centerView(view.zoom, board.buffer.width, board.buffer.height, viewW, viewH),
      offsetX: (viewW - board.buffer.width * view.zoom) / 2 - board.x * view.zoom,
      offsetY: (viewH - board.buffer.height * view.zoom) / 2 - board.y * view.zoom,
    });
  }

  /** Меняет зум на steps уровней вокруг центра области просмотра (кнопки и клавиши +/−). */
  export function zoomBy(steps: number): void {
    view = clampSceneView(zoomAt(view, steps, viewW / 2, viewH / 2));
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

  function snapBoardPosition(board: Board, x: number, y: number): {
    x: number;
    y: number;
    guides: AlignmentGuide[];
  } {
    let bestX: { coordinate: number; edge: 'left' | 'right'; board: Board; distance: number } | null = null;
    let bestY: { coordinate: number; edge: 'top' | 'bottom'; board: Board; distance: number } | null = null;
    const threshold = Math.max(1, ALIGNMENT_SNAP_DISTANCE / view.zoom);

    for (const other of boards) {
      if (other.id === board.id) continue;
      for (const movingEdge of ['left', 'right'] as const) {
        const movingCoordinate = x + (movingEdge === 'right' ? board.buffer.width : 0);
        for (const stationaryEdge of ['left', 'right'] as const) {
          const coordinate = other.x + (stationaryEdge === 'right' ? other.buffer.width : 0);
          const distance = Math.abs(coordinate - movingCoordinate);
          if (distance <= threshold && (!bestX || distance < bestX.distance)) {
            bestX = { coordinate, edge: movingEdge, board: other, distance };
          }
        }
      }
      for (const movingEdge of ['top', 'bottom'] as const) {
        const movingCoordinate = y + (movingEdge === 'bottom' ? board.buffer.height : 0);
        for (const stationaryEdge of ['top', 'bottom'] as const) {
          const coordinate = other.y + (stationaryEdge === 'bottom' ? other.buffer.height : 0);
          const distance = Math.abs(coordinate - movingCoordinate);
          if (distance <= threshold && (!bestY || distance < bestY.distance)) {
            bestY = { coordinate, edge: movingEdge, board: other, distance };
          }
        }
      }
    }

    const snappedX = bestX
      ? bestX.coordinate - (bestX.edge === 'right' ? board.buffer.width : 0)
      : x;
    const snappedY = bestY
      ? bestY.coordinate - (bestY.edge === 'bottom' ? board.buffer.height : 0)
      : y;
    const guides: AlignmentGuide[] = [];

    if (bestX) {
      const movingY = bestX.edge === 'left' ? snappedY : snappedY + board.buffer.height;
      const stationaryY = Math.abs(movingY - bestX.board.y) <=
          Math.abs(movingY - (bestX.board.y + bestX.board.buffer.height))
        ? bestX.board.y
        : bestX.board.y + bestX.board.buffer.height;
      guides.push({
        x1: bestX.coordinate,
        y1: movingY,
        x2: bestX.coordinate,
        y2: stationaryY,
      });
    }

    if (bestY) {
      const movingX = bestY.edge === 'top' ? snappedX : snappedX + board.buffer.width;
      const stationaryX = Math.abs(movingX - bestY.board.x) <=
          Math.abs(movingX - (bestY.board.x + bestY.board.buffer.width))
        ? bestY.board.x
        : bestY.board.x + bestY.board.buffer.width;
      guides.push({
        x1: movingX,
        y1: bestY.coordinate,
        x2: stationaryX,
        y2: bestY.coordinate,
      });
    }

    return { x: snappedX, y: snappedY, guides };
  }

  function guideBox(guide: AlignmentGuide): { left: number; top: number; width: number; height: number } {
    return {
      left: Math.min(guide.x1, guide.x2) * view.zoom,
      top: Math.min(guide.y1, guide.y2) * view.zoom,
      width: Math.max(1, Math.abs(guide.x2 - guide.x1) * view.zoom),
      height: Math.max(1, Math.abs(guide.y2 - guide.y1) * view.zoom),
    };
  }

  function guideLine(guide: AlignmentGuide): { x1: number; y1: number; x2: number; y2: number } {
    const box = guideBox(guide);
    if (guide.x1 === guide.x2) {
      return {
        x1: box.width / 2,
        y1: guide.y1 <= guide.y2 ? 0 : box.height,
        x2: box.width / 2,
        y2: guide.y1 <= guide.y2 ? box.height : 0,
      };
    }
    if (guide.y1 === guide.y2) {
      return {
        x1: guide.x1 <= guide.x2 ? 0 : box.width,
        y1: box.height / 2,
        x2: guide.x1 <= guide.x2 ? box.width : 0,
        y2: box.height / 2,
      };
    }
    return {
      x1: guide.x1 <= guide.x2 ? 0 : box.width,
      y1: guide.y1 <= guide.y2 ? 0 : box.height,
      x2: guide.x1 <= guide.x2 ? box.width : 0,
      y2: guide.y1 <= guide.y2 ? box.height : 0,
    };
  }

  function getSceneBounds(): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
    if (boards.length === 0) {
      return { minX: 0, minY: 0, maxX: buffer.width, maxY: buffer.height, width: buffer.width, height: buffer.height };
    }
    const minX = Math.min(...boards.map((board) => board.x));
    const minY = Math.min(...boards.map((board) => board.y));
    const maxX = Math.max(...boards.map((board) => board.x + board.buffer.width));
    const maxY = Math.max(...boards.map((board) => board.y + board.buffer.height));
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  function clampSceneView(next: ViewState): ViewState {
    const bounds = getSceneBounds();
    const width = bounds.width * next.zoom;
    const height = bounds.height * next.zoom;
    const marginX = Math.min(48, width, viewW / 2);
    const marginY = Math.min(48, height, viewH / 2);
    return {
      zoom: next.zoom,
      offsetX: Math.round(Math.max(viewW - marginX - bounds.maxX * next.zoom, Math.min(marginX - bounds.minX * next.zoom, next.offsetX))),
      offsetY: Math.round(Math.max(viewH - marginY - bounds.maxY * next.zoom, Math.min(marginY - bounds.minY * next.zoom, next.offsetY))),
    };
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

  function getHorizontalScrollMetrics(): {
    scrollContentWidth: number;
  } {
    return { scrollContentWidth: viewW + HORIZONTAL_SCROLL_RANGE };
  }

  function onHorizontalScroll(): void {
    if (!horizontalScrollEl) return;
    const margin = Math.min(48, sceneBounds.width * view.zoom, viewW / 2);
    const minOffset = viewW - margin - sceneBounds.maxX * view.zoom;
    const maxOffset = margin - sceneBounds.minX * view.zoom;
    const range = maxOffset - minOffset;
    const ratio = horizontalScrollEl.scrollLeft / HORIZONTAL_SCROLL_RANGE;
    view = clampSceneView({ ...view, offsetX: maxOffset - range * ratio });
  }

  $effect(() => {
    const currentScroll = horizontalScrollEl;
    const margin = Math.min(48, sceneBounds.width * view.zoom, viewW / 2);
    const minOffset = viewW - margin - sceneBounds.maxX * view.zoom;
    const maxOffset = margin - sceneBounds.minX * view.zoom;
    const range = maxOffset - minOffset;
    const ratio = range > 0 ? (maxOffset - view.offsetX) / range : 0;
    const target = ratio * HORIZONTAL_SCROLL_RANGE;
    if (currentScroll && Math.abs(currentScroll.scrollLeft - target) > 1) {
      untrack(() => {
        currentScroll.scrollLeft = Math.max(0, target);
      });
    }
  });

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

    // deltaY < 0: прокрутка от себя — приближение
    view = zoomAt(view, -steps, e.clientX - originX, e.clientY - originY);
    lastClient = { x: e.clientX, y: e.clientY };
    updateCursor();
  }

  // ——— Касания: два пальца — масштаб и перемещение ———

  function startGesture(): void {
    const [first, second] = [...touches.entries()];
    if (!first || !second) return;
    // Первый палец уже мог начать штрих: он отменяется целиком, чтобы не остаться случайной точке
    session.abortAny();

    const midX = (first[1].x + second[1].x) / 2 - originX;
    const midY = (first[1].y + second[1].y) / 2 - originY;
    gesture = {
      ids: [first[0], second[0]],
      startDistance: Math.max(1, Math.hypot(first[1].x - second[1].x, first[1].y - second[1].y)),
      startZoom: view.zoom,
      startMidX: midX,
      startMidY: midY,
      startOffsetX: view.offsetX,
      startOffsetY: view.offsetY,
    };
    touchLocked = true;
  }

  function updateGesture(): void {
    if (!gesture) return;
    const a = touches.get(gesture.ids[0]);
    const b = touches.get(gesture.ids[1]);
    if (!a || !b) return;

    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const midX = (a.x + b.x) / 2 - originX;
    const midY = (a.y + b.y) / 2 - originY;
    const zoom = nearestZoomLevel((gesture.startZoom * distance) / gesture.startDistance);

    // Точка холста, бывшая под серединой в начале жеста, остаётся под серединой
    const canvasX = (gesture.startMidX - gesture.startOffsetX) / gesture.startZoom;
    const canvasY = (gesture.startMidY - gesture.startOffsetY) / gesture.startZoom;
    view = clampSceneView(
      { zoom, offsetX: Math.round(midX - canvasX * zoom), offsetY: Math.round(midY - canvasY * zoom) },
    );
  }

  function forgetTouch(pointerId: number): void {
    touches.delete(pointerId);
    if (gesture && gesture.ids.includes(pointerId)) gesture = null;
    if (touches.size === 0) touchLocked = false;
  }

  // ——— Указатель: мышь, перо, касание ———

  function onPointerDown(e: PointerEvent): void {
    if (!viewportEl) return;
    refreshOrigin();
    keyboardCursorShown = false;

    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2) {
        if (!gesture) startGesture();
        return;
      }
      if (touchLocked) return;
    }

    const board = boardAt(e.clientX, e.clientY);
    if (e.button === 2 && e.ctrlKey && board) {
      if (session.isActive) return;
      e.preventDefault();
      onselectboard(board.id);
      movingBoardId = board.id;
      movingPointerId = e.pointerId;
      movingBoardStart = { x: e.clientX, y: e.clientY, boardX: board.x, boardY: board.y };
      dragPreview = { id: board.id, x: board.x, y: board.y };
      viewportEl.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button === 2) {
      if (panning || session.isActive) return;
      e.preventDefault();
      rightPanPointerId = e.pointerId;
      rightClickBoardId = board?.id ?? null;
      panStart = { x: e.clientX, y: e.clientY, offsetX: view.offsetX, offsetY: view.offsetY };
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

    // Рисование: левая кнопка (касание и перо тоже считаются левой) — основной цвет,
    // правая — дополнительный
    if (panning || session.isActive || panMode) return;
    if (!board || board.id !== activeBoardId) return;
    const slot: ColorSlot | null = e.button === 0 ? 'primary' : e.button === 2 ? 'secondary' : null;
    if (slot === null) return;

    e.preventDefault();
    viewportEl.focus({ preventScroll: true });
    viewportEl.setPointerCapture(e.pointerId);
    const p = pixelAtBoard(board, e.clientX, e.clientY);
    activeStrokeBoardId = board.id;
    session.start(e.pointerId, tool, slot, p.x, p.y);
  }

  function onPointerMove(e: PointerEvent): void {
    lastClient = { x: e.clientX, y: e.clientY };

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
      const dx = Math.round((e.clientX - movingBoardStart.x) / view.zoom);
      const dy = Math.round((e.clientY - movingBoardStart.y) / view.zoom);
      const movingBoard = boards.find((board) => board.id === movingBoardId);
      if (movingBoard) {
        const snapped = snapBoardPosition(
          movingBoard,
          movingBoardStart.boardX + dx,
          movingBoardStart.boardY + dy,
        );
        dragPreview = { id: movingBoardId, x: snapped.x, y: snapped.y };
        alignmentGuides = snapped.guides;
      }
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
      view = clampSceneView(
        {
          zoom: view.zoom,
          offsetX: panStart.offsetX + (e.clientX - panStart.x),
          offsetY: panStart.offsetY + (e.clientY - panStart.y),
        },
      );
    } else if (session.isActiveFor(e.pointerId)) {
      // Объединённые события дают все промежуточные позиции быстрого движения;
      // оставшиеся разрывы закрывает Брезенхэм внутри инструмента
      const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const events = coalesced.length > 0 ? coalesced : [e];
      const board = activeStrokeBoardId
        ? boards.find((entry) => entry.id === activeStrokeBoardId)
        : undefined;
      if (board) session.move(e.pointerId, events.map((event) => pixelAtBoard(board, event.clientX, event.clientY)));
    }

    updateCursor();
  }

  function releasePointer(pointerId: number): void {
    if (viewportEl?.hasPointerCapture(pointerId)) viewportEl.releasePointerCapture(pointerId);
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.pointerType === 'touch') forgetTouch(e.pointerId);

    if (movingBoardId !== null && movingPointerId === e.pointerId) {
      const movedId = movingBoardId;
      const preview = dragPreview;
      movingBoardId = null;
      movingPointerId = -1;
      dragPreview = null;
      alignmentGuides = [];
      if (preview?.id === movedId) onmoveboard(movedId, preview.x, preview.y);
      releasePointer(e.pointerId);
      return;
    }

    if (rightPanPointerId === e.pointerId) {
      rightPanPointerId = -1;
      if (!panning) {
        const board = rightClickBoardId ? boards.find((entry) => entry.id === rightClickBoardId) : undefined;
        if (board && board.id === activeBoardId) {
          const point = pixelAtBoard(board, e.clientX, e.clientY);
          session.start(e.pointerId, tool, 'secondary', point.x, point.y);
          session.finish(e.pointerId, point);
        }
      }
      rightClickBoardId = null;
    }

    if (panning && e.pointerId === panPointerId) {
      panning = false;
      panPointerId = -1;
      releasePointer(e.pointerId);
    }
    if (session.isActiveFor(e.pointerId)) {
      const board = activeStrokeBoardId ? boards.find((entry) => entry.id === activeStrokeBoardId) : undefined;
      if (board) session.finish(e.pointerId, pixelAtBoard(board, e.clientX, e.clientY));
      activeStrokeBoardId = null;
      releasePointer(e.pointerId);
    }
    updateCursor();
  }

  /** Браузер забрал ввод (системный жест, ладонь на экране): штрих отменяется целиком. */
  function onPointerCancel(e: PointerEvent): void {
    if (e.pointerType === 'touch') forgetTouch(e.pointerId);
    if (rightPanPointerId === e.pointerId) rightPanPointerId = -1;
    if (movingBoardId !== null && movingPointerId === e.pointerId) {
      movingBoardId = null;
      movingPointerId = -1;
      dragPreview = null;
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
   * Захват потерян без pointerup (окно потеряло фокус, отпускание вне приложения):
   * без этого штрих «залипал» бы и блокировал рисование до перезагрузки страницы.
   */
  function onLostPointerCapture(e: PointerEvent): void {
    if (rightPanPointerId === e.pointerId) rightPanPointerId = -1;
    if (movingBoardId !== null && movingPointerId === e.pointerId) {
      movingBoardId = null;
      movingPointerId = -1;
      dragPreview = null;
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
      view = clampSceneView(ensurePixelVisible(view, board.x + keyboardX, board.y + keyboardY, viewW, viewH));
    }
    if (session.isActiveFor('keyboard')) session.move('keyboard', [{ x: keyboardX, y: keyboardY }]);
  }

  function toggleKeyboardStroke(slot: ColorSlot): void {
    const here = { x: keyboardX, y: keyboardY };
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
    if (session.isActiveFor('keyboard')) {
      session.finish('keyboard');
      keyboardPenDown = false;
    }
  }

  onMount(() => {
    const el = viewportEl;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      viewW = rect.width;
      viewH = rect.height;
      refreshOrigin();
      if (!ensureFit()) {
        view = clampSceneView(view);
      }
    });
    observer.observe(el);

    // passive: false нужен, чтобы колесо не прокручивало страницу
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      observer.disconnect();
      el.removeEventListener('wheel', onWheel);
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
    aria-label="Рабочее поле холстов. Ctrl и правая кнопка мыши выделяют и перемещают холст."
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
    <div
      class="stage"
      style:transform="translate({view.offsetX}px, {view.offsetY}px)"
    >
      {#each boards as board (board.id)}
        <div
          class="board"
          class:selected={board.id === activeBoardId}
          style:left="{board.x * view.zoom}px"
          style:top="{board.y * view.zoom}px"
          style:width="{board.buffer.width * view.zoom}px"
          style:height="{board.buffer.height * view.zoom}px"
          style:background={canvasBackground}
        >
          <canvas use:registerBoardCanvas={board.id}></canvas>
          {#if showGrid && view.zoom >= GRID_MIN_ZOOM}
            <div class="grid" style:background-size="{view.zoom}px {view.zoom}px"></div>
          {/if}
        </div>
      {/each}
      {#if dragPreview}
        {@const previewBoard = boards.find((board) => board.id === dragPreview?.id)}
        {#if previewBoard && (previewBoard.x !== dragPreview.x || previewBoard.y !== dragPreview.y)}
          <div
            class="drop-preview"
            style:left="{dragPreview.x * view.zoom}px"
            style:top="{dragPreview.y * view.zoom}px"
            style:width="{previewBoard.buffer.width * view.zoom}px"
            style:height="{previewBoard.buffer.height * view.zoom}px"
            aria-hidden="true"
          ></div>
        {/if}
      {/if}
      {#each alignmentGuides as guide, index (`${guide.x1}:${guide.y1}:${guide.x2}:${guide.y2}:${index}`)}
        {@const box = guideBox(guide)}
        {@const line = guideLine(guide)}
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
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="horizontal-scroll"
    bind:this={horizontalScrollEl}
    role="region"
    aria-label="Горизонтальная прокрутка холста"
    tabindex="0"
    onscroll={onHorizontalScroll}
  >
    <div class="horizontal-scroll-content" style:width="{horizontalScroll.scrollContentWidth}px"></div>
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

  .stage {
    position: absolute;
    left: 0;
    top: 0;
    will-change: transform;
  }

  .board {
    position: absolute;
    box-shadow:
      0 0 0 1px #4a4e60,
      0 12px 40px rgba(0, 0, 0, 0.55);
  }

  .board.selected {
    outline: 2px solid var(--accent);
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

  .horizontal-scroll {
    flex: 0 0 16px;
    overflow-x: auto;
    overflow-y: hidden;
    background: var(--panel-2);
    scrollbar-color: var(--text-dim) var(--panel-2);
    touch-action: pan-x;
  }

  .horizontal-scroll-content {
    height: 1px;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
  }

  .grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(to right, rgba(150, 155, 175, 0.4) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(150, 155, 175, 0.4) 1px, transparent 1px);
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
