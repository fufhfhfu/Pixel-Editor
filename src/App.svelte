<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import Canvas from './components/Canvas.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import HelpDialog from './components/HelpDialog.svelte';
  import SettingsDialog from './components/SettingsDialog.svelte';
  import PalettePanel from './components/PalettePanel.svelte';
  import ProjectBar from './components/ProjectBar.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import Toast from './components/Toast.svelte';
  import ToolPanel from './components/ToolPanel.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import {
    DEFAULT_EXPORT_SCALE,
    downloadBlob,
    exportPngBlob,
    exportRasterBlob,
    getAvailableExportScales,
    isExportScale,
    type ExportFormat,
    type ExportScale,
  } from './core/export';
  import { decodeRasterImage, MAX_IMAGE_FILE_BYTES, rasterImageToProject } from './core/imageImport';
  import { History } from './core/history';
  import {
    DEFAULT_PALETTE_ID,
    PALETTES,
    constrainColor,
    filterToPalette,
    getPalette,
    nearestPaletteColor,
    pushRecentColor,
    type ColorSlot,
  } from './core/palette';
  import {
    MAX_PROJECT_JSON_LENGTH,
    MAX_PROJECT_CANVASES,
    MAX_PROJECT_CANVAS_COORDINATE,
    MAX_PROJECT_TOTAL_PIXELS,
    ProjectFormatError,
    parseProject,
    serializeProject,
    type ProjectData,
  } from './core/project';
  import {
    loadEditorPreferences,
    saveCanvasBackground,
    saveWorkspaceBackground,
    saveCustomSizes,
    saveThemePreference,
    currentSizeIsBuiltIn,
    MAX_CUSTOM_SIZES,
    type CanvasSize,
    type ThemePreference,
  } from './core/preferences';
  import {
    AutosaveRepository,
    pickSaveFileHandle,
    supportsSaveFilePicker,
    writeBlobToFile,
    type SaveFileHandle,
    type AutosaveStorageMode,
  } from './core/autosave';
  import { DEFAULT_GRID_SIZE, PixelBuffer, isValidCanvasSize, type RGBA } from './core/state';
  import { getBrowserStorage, type SaveStatus } from './core/storage';
  import type { StrokeOutcome } from './core/stroke';
  import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE, TOOLS, clampBrushSize, getTool, type ToolId } from './core/tools';
  import type { PixelPos, ViewState } from './core/viewport';

  interface Props {
    initialProject: ProjectData | null;
    initialLoadError: string | null;
    initialStorageMode: AutosaveStorageMode;
    autosaveRepository: AutosaveRepository;
  }

  let { initialProject, initialLoadError, initialStorageMode, autosaveRepository }: Props = $props();

  /** Действие, которое ждёт подтверждения в диалоге. */
  type PendingAction =
    | { kind: 'resize'; width: number; height: number }
    | { kind: 'import'; project: ProjectData; fileName: string }
    | { kind: 'image'; project: ProjectData; fileName: string }
    | { kind: 'clear' };

  interface Notice {
    text: string;
    kind: 'info' | 'error';
  }

  interface Artboard {
    id: string;
    x: number;
    y: number;
    buffer: PixelBuffer;
  }

  type BoardAction =
    | { kind: 'add'; board: Artboard; index: number; previousActiveBoardId: string }
    | {
        kind: 'move';
        before: Array<{ id: string; x: number; y: number }>;
        after: Array<{ id: string; x: number; y: number }>;
      };
  type UndoEntry = { kind: 'pixels'; boardId: string } | { kind: 'board'; action: BoardAction };

  /** Пауза после последнего изменения перед сохранением проекта в локальное хранилище. */
  const AUTOSAVE_DELAY_MS = 800;
  const NOTICE_DURATION_MS = 5000;

  // Стартовые цвета подбираются по ближайшему цвету палитры по умолчанию
  const START_PRIMARY: RGBA = { r: 255, g: 0, b: 77, a: 255 };
  const START_SECONDARY: RGBA = { r: 255, g: 241, b: 232, a: 255 };

  const storage = getBrowserStorage();
  const preferences = loadEditorPreferences(storage);
  const start = untrack(() => initialProject);
  const startupStorageMode = untrack(() => initialStorageMode);
  const startPalette = getPalette(start?.paletteId ?? DEFAULT_PALETTE_ID);

  const initialBoards: Artboard[] = start?.canvases
    ? start.canvases.map((canvas) => ({
        id: canvas.id,
        x: canvas.x,
        y: canvas.y,
        buffer: new PixelBuffer(canvas.width, canvas.height, canvas.pixels),
      }))
    : [{
        id: start?.activeCanvasId ?? 'canvas-1',
        x: 0,
        y: 0,
        buffer: start
          ? new PixelBuffer(start.width, start.height, start.pixels)
          : new PixelBuffer(DEFAULT_GRID_SIZE, DEFAULT_GRID_SIZE),
      }];
  const histories = new Map(initialBoards.map((board) => [board.id, new History()]));
  const undoTimeline: UndoEntry[] = [];
  const redoTimeline: UndoEntry[] = [];
  let history = histories.get(start?.activeCanvasId ?? initialBoards[0]!.id)!;
  let boards = $state.raw<Artboard[]>(initialBoards);
  let activeBoardId = $state(start?.activeCanvasId ?? initialBoards[0]!.id);
  let buffer = $state.raw(initialBoards.find((board) => board.id === activeBoardId)!.buffer);
  let view = $state.raw<ViewState>({ zoom: 1, offsetX: 0, offsetY: 0 });
  let cursor = $state.raw<PixelPos | null>(null);
  let showGrid = $state(true);
  let canvasBackground = $state(preferences.canvasBackground);
  let workspaceBackground = $state(preferences.workspaceBackground);
  let customSizes = $state.raw<CanvasSize[]>(preferences.customSizes);
  let spaceHeld = $state(false);
  let pending = $state.raw<PendingAction | null>(null);
  let helpOpen = $state(false);
  let helpTrigger = $state<HTMLElement | null>(null);
  let settingsOpen = $state(false);
  let settingsTab = $state<'general' | 'background'>('general');
  let settingsTrigger = $state<HTMLElement | null>(null);
  let theme = $state<ThemePreference>(preferences.theme);
  const saveFilePickerSupported = supportsSaveFilePicker();
  let canvasApi = $state.raw<ReturnType<typeof Canvas>>();
  let boardSequence = 1;

  let activeToolId = $state<ToolId>('pencil');
  let brushSize = $state(MIN_BRUSH_SIZE);

  let paletteId = $state(start?.paletteId ?? DEFAULT_PALETTE_ID);
  let freeColor = $state(start?.freeColor ?? false);
  let primary = $state.raw<RGBA>(start?.primary ?? nearestPaletteColor(startPalette, START_PRIMARY));
  let secondary = $state.raw<RGBA>(start?.secondary ?? nearestPaletteColor(startPalette, START_SECONDARY));
  let recent = $state.raw<RGBA[]>(start?.recent ?? []);

  let canUndo = $state(false);
  let canRedo = $state(false);
  let exportFormat = $state<ExportFormat>('png');
  let exportScale = $state<ExportScale>(DEFAULT_EXPORT_SCALE);
  const availableExportScales = $derived(getAvailableExportScales(buffer.width, buffer.height));

  $effect(() => {
    if (!isExportScale(exportScale) || !availableExportScales.includes(exportScale)) {
      exportScale = availableExportScales.at(-1) ?? 1;
    }
  });

  let saveStatus = $state<SaveStatus>(
    startupStorageMode === 'indexeddb'
      ? 'saved'
      : startupStorageMode === 'localstorage'
        ? 'degraded'
        : 'unavailable',
  );
  let savedAt = $state<number | null>(null);
  let notice = $state.raw<Notice | null>(null);

  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let autosaveFailureReported = false;
  let autosaveArmed = false;
  let autosaveRevision = 0;

  const activeTool = $derived(getTool(activeToolId));
  const palette = $derived(getPalette(paletteId));
  // В режиме палитры показываем только недавние цвета, которые в ней есть
  const visibleRecent = $derived(freeColor ? recent : filterToPalette(recent, palette));

  $effect(() => {
    document.documentElement.dataset.theme = theme;
  });

  // ——— Уведомления ———

  function dismissNotice(): void {
    clearTimeout(noticeTimer);
    notice = null;
  }

  function notify(text: string, kind: Notice['kind'] = 'info'): void {
    clearTimeout(noticeTimer);
    notice = { text, kind };
    noticeTimer = setTimeout(dismissNotice, NOTICE_DURATION_MS);
  }

  // ——— Автосохранение ———

  function currentProject(): ProjectData {
    return {
      width: buffer.width,
      height: buffer.height,
      pixels: buffer.data,
      paletteId,
      freeColor,
      primary,
      secondary,
      recent,
      canvases: boards.map((board) => ({
        id: board.id,
        x: board.x,
        y: board.y,
        width: board.buffer.width,
        height: board.buffer.height,
        pixels: board.buffer.data,
      })),
      activeCanvasId: activeBoardId,
    };
  }

  function setActiveBuffer(next: PixelBuffer): void {
    buffer = next;
    boards = boards.map((board) => board.id === activeBoardId ? { ...board, buffer: next } : board);
  }

  function selectBoard(id: string): void {
    const board = boards.find((entry) => entry.id === id);
    if (!board || id === activeBoardId) return;
    activeBoardId = id;
    buffer = board.buffer;
    history = histories.get(id) ?? new History();
    histories.set(id, history);
    syncHistory();
    cursor = null;
    scheduleAutosave();
  }

  function moveBoard(id: string, x: number, y: number): void {
    if (
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      Math.abs(x) > MAX_PROJECT_CANVAS_COORDINATE ||
      Math.abs(y) > MAX_PROJECT_CANVAS_COORDINATE
    ) {
      notify('Холст нельзя переместить за пределы рабочего поля.', 'error');
      return;
    }
    const moving = boards.find((board) => board.id === id);
    if (!moving || (moving.x === x && moving.y === y)) return;
    const before = [{ id: moving.id, x: moving.x, y: moving.y }];
    const collided = boards
      .filter((board) => board.id !== id)
      .map((board) => {
        const overlapWidth = Math.max(0, Math.min(x + moving.buffer.width, board.x + board.buffer.width) - Math.max(x, board.x));
        const overlapHeight = Math.max(0, Math.min(y + moving.buffer.height, board.y + board.buffer.height) - Math.max(y, board.y));
        const overlapArea = overlapWidth * overlapHeight;
        return { board, overlapArea, ratio: overlapArea / (board.buffer.width * board.buffer.height) };
      })
      .filter((collision) => collision.ratio >= 0.5)
      .sort((a, b) => b.ratio - a.ratio || b.overlapArea - a.overlapArea)[0]?.board;
    if (collided) before.push({ id: collided.id, x: collided.x, y: collided.y });
    const after = collided
      ? [
          { id: moving.id, x: collided.x, y: collided.y },
          { id: collided.id, x: moving.x, y: moving.y },
        ]
      : [{ id: moving.id, x, y }];
    applyBoardPositions(after);
    pushUndoEntry({ kind: 'board', action: { kind: 'move', before, after } });
    scheduleAutosave();
  }

  function findBoardPosition(width: number, height: number, origin: Artboard): { x: number; y: number } | null {
    const gap = 24;
    for (let radius = 1; radius <= boards.length + 1; radius++) {
      const candidates: Array<{ x: number; y: number; distance: number }> = [];
      for (let row = -radius; row <= radius; row++) {
        for (let column = -radius; column <= radius; column++) {
          if (Math.max(Math.abs(column), Math.abs(row)) !== radius) continue;
          candidates.push({
            x: origin.x + column * (width + gap),
            y: origin.y + row * (height + gap),
            distance: Math.abs(column) + Math.abs(row),
          });
        }
      }
      const preferred = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];
      candidates.sort((a, b) => {
        const distanceOrder = a.distance - b.distance;
        if (distanceOrder !== 0) return distanceOrder;
        const rank = (candidate: { x: number; y: number }) => {
          const column = (candidate.x - origin.x) / (width + gap);
          const row = (candidate.y - origin.y) / (height + gap);
          return preferred.findIndex(([preferredColumn, preferredRow]) => column === preferredColumn * radius && row === preferredRow * radius);
        };
        const rankA = rank(a);
        const rankB = rank(b);
        if (rankA !== rankB) return (rankA < 0 ? preferred.length : rankA) - (rankB < 0 ? preferred.length : rankB);
        return a.y - b.y || a.x - b.x;
      });
      for (const candidate of candidates) {
        if (
          Math.abs(candidate.x) > MAX_PROJECT_CANVAS_COORDINATE ||
          Math.abs(candidate.y) > MAX_PROJECT_CANVAS_COORDINATE
        ) continue;
        const overlaps = boards.some((board) =>
          candidate.x < board.x + board.buffer.width &&
          candidate.x + width > board.x &&
          candidate.y < board.y + board.buffer.height &&
          candidate.y + height > board.y,
        );
        if (!overlaps) return { x: candidate.x, y: candidate.y };
      }
    }
    return null;
  }

  async function addBoard(): Promise<void> {
    if (boards.length >= MAX_PROJECT_CANVASES) {
      notify(`В проекте может быть не больше ${MAX_PROJECT_CANVASES} холстов.`, 'error');
      return;
    }
    const totalPixels = boards.reduce((total, entry) => total + entry.buffer.width * entry.buffer.height, 0);
    if (totalPixels + buffer.width * buffer.height > MAX_PROJECT_TOTAL_PIXELS) {
      notify(
        `Общая площадь холстов не может превышать ${MAX_PROJECT_TOTAL_PIXELS.toLocaleString('ru-RU')} пикселей.`,
        'error',
      );
      return;
    }
    const previousActiveBoardId = activeBoardId;
    const activeBoard = boards.find((board) => board.id === activeBoardId) ?? boards[0]!;
    const position = findBoardPosition(buffer.width, buffer.height, activeBoard);
    if (!position) {
      notify('Не удалось найти свободное место рядом с рабочей областью.', 'error');
      return;
    }
    const id = `canvas-${Date.now().toString(36)}-${boardSequence++}`;
    const board: Artboard = {
      id,
      ...position,
      buffer: new PixelBuffer(buffer.width, buffer.height),
    };
    const index = boards.length;
    boards = [...boards, board];
    activeBoardId = id;
    buffer = board.buffer;
    history = new History();
    histories.set(id, history);
    pushUndoEntry({ kind: 'board', action: { kind: 'add', board, index, previousActiveBoardId } });
    syncHistory();
    cursor = null;
    await tick();
    scheduleAutosave();
    notify(`Холст ${boards.length} добавлен.`);
  }

  async function runAutosave(): Promise<void> {
    autosaveTimer = undefined;
    const revision = autosaveRevision;
    if (!autosaveRepository.canPersist) {
      saveStatus = 'unavailable';
      return;
    }

    // Штрих ещё идёт: не сохраняем половину линии, попробуем позже
    if (history.hasPendingStroke) {
      autosaveTimer = setTimeout(runAutosave, AUTOSAVE_DELAY_MS);
      return;
    }

    try {
      const mode = await autosaveRepository.save(currentProject());
      if (revision !== autosaveRevision) return;
      saveStatus = mode === 'indexeddb' ? 'saved' : 'degraded';
      savedAt = Date.now();
      autosaveFailureReported = false;
      if (mode === 'localstorage' && !autosaveFailureReported) {
        autosaveFailureReported = true;
        notify('IndexedDB недоступна: проект сохранён в localStorage, где может не хватить места. Сохраните важную работу в JSON.', 'error');
      }
    } catch (error) {
      if (revision !== autosaveRevision) return;
      saveStatus = 'error';
      if (!autosaveFailureReported) {
        autosaveFailureReported = true;
        notify(
          `${error instanceof Error ? error.message : 'Автосохранение не удалось.'} Сохраните проект в файл JSON.`,
          'error',
        );
      }
    }
  }

  function scheduleAutosave(): void {
    if (!autosaveRepository.canPersist) {
      saveStatus = 'unavailable';
      return;
    }
    autosaveRevision++;
    saveStatus = 'pending';
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(runAutosave, AUTOSAVE_DELAY_MS);
  }

  /** Сохраняет немедленно, если изменения ещё ждут таймера (закрытие вкладки, переключение). */
  function flushAutosave(): void {
    if (autosaveTimer === undefined) return;
    clearTimeout(autosaveTimer);
    runAutosave();
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') flushAutosave();
  }

  $effect(() => {
    if (initialLoadError) notify(initialLoadError, 'error');
  });

  // Изменения палитры и цветов тоже уходят в автосохранение (первый запуск пропускаем:
  // иначе нечитаемое старое сохранение было бы тут же перезаписано пустым проектом)
  $effect(() => {
    void paletteId;
    void freeColor;
    void primary;
    void secondary;
    void recent;
    if (!autosaveArmed) {
      autosaveArmed = true;
      return;
    }
    scheduleAutosave();
  });

  onDestroy(() => {
    clearTimeout(autosaveTimer);
    clearTimeout(noticeTimer);
  });

  // ——— История ———

  function syncHistory(): void {
    canUndo = undoTimeline.length > 0;
    canRedo = redoTimeline.length > 0;
  }

  function pushUndoEntry(entry: UndoEntry): void {
    undoTimeline.push(entry);
    redoTimeline.length = 0;
    for (const boardHistory of histories.values()) boardHistory.discardRedo();
    if (entry.kind === 'pixels') {
      const historyCount = histories.get(entry.boardId)?.undoCount ?? 0;
      let timelineCount = undoTimeline.filter(
        (candidate) => candidate.kind === 'pixels' && candidate.boardId === entry.boardId,
      ).length;
      while (timelineCount > historyCount) {
        const oldestIndex = undoTimeline.findIndex(
          (candidate) => candidate.kind === 'pixels' && candidate.boardId === entry.boardId,
        );
        if (oldestIndex < 0) break;
        undoTimeline.splice(oldestIndex, 1);
        timelineCount--;
      }
    }
    syncHistory();
  }

  function applyBoardPositions(positions: Array<{ id: string; x: number; y: number }>): void {
    const changes = new Map(positions.map((position) => [position.id, position]));
    boards = boards.map((board) => {
      const position = changes.get(board.id);
      return position ? { ...board, x: position.x, y: position.y } : board;
    });
  }

  function setActiveBoard(id: string): void {
    const board = boards.find((entry) => entry.id === id);
    if (!board) return;
    activeBoardId = id;
    buffer = board.buffer;
    history = histories.get(id) ?? new History();
    histories.set(id, history);
    cursor = null;
  }

  function applyBoardAction(action: BoardAction, direction: 'undo' | 'redo'): void {
    if (action.kind === 'move') {
      applyBoardPositions(direction === 'undo' ? action.before : action.after);
      scheduleAutosave();
      return;
    }
    if (direction === 'undo') {
      boards = boards.filter((board) => board.id !== action.board.id);
      setActiveBoard(action.previousActiveBoardId);
    } else {
      boards = [...boards.slice(0, action.index), action.board, ...boards.slice(action.index)];
      setActiveBoard(action.board.id);
    }
    syncHistory();
    scheduleAutosave();
  }

  function beginStroke(): void {
    history.begin(buffer);
  }

  function endStroke(outcome: StrokeOutcome): void {
    if (outcome === 'rollback') {
      history.rollback(buffer);
      return;
    }
    if (history.commit(buffer)) {
      pushUndoEntry({ kind: 'pixels', boardId: activeBoardId });
      scheduleAutosave();
    }
  }

  /** Применяет результат undo/redo к указанному холсту. */
  function applyHistoryResult(next: PixelBuffer | null, boardId: string): boolean {
    if (!next) return false;
    const target = boards.find((board) => board.id === boardId);
    if (!target) return false;
    if (next !== target.buffer) {
      boards = boards.map((board) => board.id === boardId ? { ...board, buffer: next } : board);
      if (activeBoardId === boardId) buffer = next;
      if (activeBoardId === boardId) cursor = null;
    }
    if (activeBoardId === boardId) {
      canvasApi?.requestRender();
    }
    scheduleAutosave();
    return true;
  }

  function undo(): void {
    const entry = undoTimeline.pop();
    if (!entry) return;
    if (entry.kind === 'board') {
      applyBoardAction(entry.action, 'undo');
    } else {
      const target = boards.find((board) => board.id === entry.boardId);
      const targetHistory = histories.get(entry.boardId);
      if (!target || !targetHistory) {
        undoTimeline.push(entry);
        return;
      }
      setActiveBoard(entry.boardId);
      if (!applyHistoryResult(targetHistory.undo(target.buffer), entry.boardId)) {
        undoTimeline.push(entry);
        return;
      }
    }
    redoTimeline.push(entry);
    syncHistory();
  }

  function redo(): void {
    const entry = redoTimeline.pop();
    if (!entry) return;
    if (entry.kind === 'board') {
      applyBoardAction(entry.action, 'redo');
    } else {
      const target = boards.find((board) => board.id === entry.boardId);
      const targetHistory = histories.get(entry.boardId);
      if (!target || !targetHistory) {
        redoTimeline.push(entry);
        return;
      }
      setActiveBoard(entry.boardId);
      if (!applyHistoryResult(targetHistory.redo(target.buffer), entry.boardId)) {
        redoTimeline.push(entry);
        return;
      }
    }
    undoTimeline.push(entry);
    syncHistory();
  }

  // ——— Инструменты и цвета ———

  function toggleGrid(): void {
    showGrid = !showGrid;
  }

  function saveCurrentSize(): void {
    const size = { width: buffer.width, height: buffer.height };
    if (currentSizeIsBuiltIn(size.width, size.height)) {
      notify('Встроенный размер не нужно сохранять отдельно.');
      return;
    }
    if (customSizes.some((saved) => saved.width === size.width && saved.height === size.height)) return;
    if (customSizes.length >= MAX_CUSTOM_SIZES) {
      notify(`Можно сохранить не больше ${MAX_CUSTOM_SIZES} пользовательских размеров.`, 'error');
      return;
    }
    const next = [...customSizes, size];
    customSizes = next;
    if (saveCustomSizes(storage, next)) notify(`Размер ${size.width}×${size.height} добавлен в список.`);
    else notify('Размер добавлен до закрытия страницы, но не сохранён: хранилище браузера недоступно.', 'error');
  }

  function removeCurrentSavedSize(): void {
    const next = customSizes.filter((size) => size.width !== buffer.width || size.height !== buffer.height);
    if (next.length === customSizes.length) return;
    customSizes = next;
    if (saveCustomSizes(storage, next)) notify('Пользовательский размер удалён из списка.');
    else notify('Размер удалён до закрытия страницы, но изменение не сохранено.', 'error');
  }

  function setCanvasBackground(color: string): void {
    if (color === canvasBackground) return;
    canvasBackground = color;
    if (!saveCanvasBackground(storage, color)) {
      notify('Фон изменён, но сохранить его настройку не удалось.', 'error');
    }
  }

  function setWorkspaceBackground(color: string): void {
    if (color === workspaceBackground) return;
    workspaceBackground = color;
    if (!saveWorkspaceBackground(storage, color)) {
      notify('Фон рабочего пространства изменён, но сохранить его настройку не удалось.', 'error');
    }
  }

  function setTheme(next: ThemePreference): void {
    theme = next;
    if (!saveThemePreference(storage, next)) {
      notify('Не удалось сохранить тему. Она будет применяться только до закрытия страницы.', 'error');
    }
  }

  function openSettings(tab: 'general' | 'background', trigger: HTMLElement): void {
    settingsTab = tab;
    settingsTrigger = trigger;
    settingsOpen = true;
  }

  function requestClear(): void {
    if (!buffer.data.some((value) => value !== 0)) {
      notify('Холст уже пуст.');
      return;
    }
    pending = { kind: 'clear' };
  }

  function fitCanvas(): void {
    canvasApi?.fit();
  }

  function selectTool(id: ToolId): void {
    activeToolId = id;
  }

  function setBrushSize(size: number): void {
    brushSize = clampBrushSize(size);
  }

  /** Все изменения цвета идут через эту функцию, поэтому правило палитры нельзя обойти. */
  function setColor(slot: ColorSlot, color: RGBA): void {
    const next = constrainColor(palette, color, freeColor);
    if (slot === 'primary') primary = next;
    else secondary = next;
  }

  function selectPalette(id: string): void {
    if (id === paletteId) return;
    const next = getPalette(id);
    paletteId = id;
    if (!freeColor) {
      primary = nearestPaletteColor(next, primary);
      secondary = nearestPaletteColor(next, secondary);
    }
  }

  function setFreeColor(enabled: boolean): void {
    freeColor = enabled;
    if (!enabled) {
      primary = nearestPaletteColor(palette, primary);
      secondary = nearestPaletteColor(palette, secondary);
    }
  }

  function swapColors(): void {
    const first = primary;
    primary = secondary;
    secondary = first;
  }

  function rememberColor(color: RGBA): void {
    recent = pushRecentColor(recent, color);
  }

  // ——— Файлы: проект JSON и PNG ———

  async function chooseSaveFile(filename: string, mimeType: string, extensions: string[]) {
    try {
      return await pickSaveFileHandle(filename, mimeType, extensions);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось открыть диалог сохранения файла.', 'error');
      return null;
    }
  }

  type SaveDestination = { kind: 'desktop' } | { kind: 'browser'; handle: SaveFileHandle } | { kind: 'download' };

  async function chooseSaveDestination(
    filename: string,
    mimeType: string,
    extensions: string[],
  ): Promise<SaveDestination | null> {
    if (window.pixelEditorDesktop) return { kind: 'desktop' };
    if (!supportsSaveFilePicker()) return { kind: 'download' };
    const handle = await chooseSaveFile(filename, mimeType, extensions);
    return handle ? { kind: 'browser', handle } : null;
  }

  async function saveOutput(blob: Blob, filename: string, destination: SaveDestination): Promise<boolean> {
    if (destination.kind === 'desktop') {
      if (!window.pixelEditorDesktop) throw new Error('Возможность сохранения в приложении недоступна.');
      const result = await window.pixelEditorDesktop.saveFile({
        suggestedName: filename,
        mimeType: blob.type,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
      return result === 'saved';
    }

    if (destination.kind === 'browser') {
      await writeBlobToFile(destination.handle, blob);
      return true;
    }

    downloadBlob(blob, filename);
    return true;
  }

  async function saveProject(): Promise<void> {
    const filename = `pixel-art-${boards.length}-canvases.json`;
    const destination = await chooseSaveDestination(filename, 'application/json', ['.json']);
    if (!destination) return;

    try {
      const text = serializeProject(currentProject());
      const blob = new Blob([text], { type: 'application/json' });
      if (await saveOutput(blob, filename, destination)) notify('Проект сохранён в файл.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось сохранить проект.', 'error');
    }
  }

  async function importProjectFile(file: File): Promise<void> {
    const extension = file.name.split('.').at(-1)?.toLowerCase();
    if (extension === 'json') {
      if (file.size > MAX_PROJECT_JSON_LENGTH) {
        notify('Файл слишком большой для проекта.', 'error');
        return;
      }
      try {
        const project = parseProject(await file.text());
        pending = { kind: 'import', project, fileName: file.name };
      } catch (error) {
        notify(error instanceof ProjectFormatError ? error.message : 'Не удалось прочитать файл проекта.', 'error');
      }
      return;
    }

    if (!extension || !['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(extension)) {
      notify('Поддерживаются проекты JSON и изображения PNG, JPEG, WebP и BMP.', 'error');
      return;
    }
    if (file.size > MAX_IMAGE_FILE_BYTES) {
      notify(`Файл изображения превышает допустимый размер ${MAX_IMAGE_FILE_BYTES / 1024 / 1024} МБ.`, 'error');
      return;
    }

    try {
      const image = await decodeRasterImage(file);
      const project = rasterImageToProject(image, { paletteId, freeColor, primary, secondary, recent });
      pending = { kind: 'image', project, fileName: file.name };
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось декодировать изображение.', 'error');
    }
  }

  async function exportImage(): Promise<void> {
    const { width, height } = buffer;
    const extension = exportFormat === 'jpeg' ? 'jpg' : exportFormat;
    const filename = `pixel-art-${width}x${height}@${exportScale}x.${extension}`;
    const mimeType = exportFormat === 'jpeg' ? 'image/jpeg' : `image/${exportFormat}`;
    const destination = await chooseSaveDestination(filename, mimeType, [`.${extension}`]);
    if (!destination) return;

    try {
      const blob =
        exportFormat === 'png'
          ? await exportPngBlob(buffer, exportScale)
          : await exportRasterBlob(buffer, exportScale, exportFormat, canvasBackground);
      if (!(await saveOutput(blob, filename, destination))) return;
      notify(
        `${exportFormat === 'jpeg' ? 'JPEG' : exportFormat.toUpperCase()} сохранён: ${width * exportScale}×${height * exportScale}.`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось создать изображение.', 'error');
    }
  }

  /** Подставляет в редактор загруженный проект; история при этом начинается заново. */
  function applyProject(project: ProjectData): void {
    boards = project.canvases
      ? project.canvases.map((canvas) => ({
          id: canvas.id,
          x: canvas.x,
          y: canvas.y,
          buffer: new PixelBuffer(canvas.width, canvas.height, canvas.pixels),
        }))
      : [{
          id: project.activeCanvasId ?? 'canvas-1',
          x: 0,
          y: 0,
          buffer: new PixelBuffer(project.width, project.height, project.pixels),
        }];
    activeBoardId = project.activeCanvasId ?? boards[0]!.id;
    buffer = boards.find((board) => board.id === activeBoardId)!.buffer;
    histories.clear();
    for (const board of boards) histories.set(board.id, new History());
    undoTimeline.length = 0;
    redoTimeline.length = 0;
    history = histories.get(activeBoardId)!;
    paletteId = project.paletteId;
    freeColor = project.freeColor;
    primary = project.primary;
    secondary = project.secondary;
    recent = project.recent;
    syncHistory();
    cursor = null;
    scheduleAutosave();
  }

  // ——— Подтверждения ———

  function requestResize(width: number, height: number): void {
    if (!isValidCanvasSize(width, height)) return;
    if (width === buffer.width && height === buffer.height) return;
    const totalPixels = boards.reduce((total, board) => total + board.buffer.width * board.buffer.height, 0);
    if (totalPixels - buffer.width * buffer.height + width * height > MAX_PROJECT_TOTAL_PIXELS) {
      notify(
        `Общая площадь холстов не может превышать ${MAX_PROJECT_TOTAL_PIXELS.toLocaleString('ru-RU')} пикселей.`,
        'error',
      );
      return;
    }
    pending = { kind: 'resize', width, height };
  }

  function confirmPending(): void {
    const action = pending;
    pending = null;
    if (!action) return;

    if (action.kind === 'clear') {
      history.begin(buffer);
      buffer.clear();
      if (history.commit(buffer)) pushUndoEntry({ kind: 'pixels', boardId: activeBoardId });
      else syncHistory();
      canvasApi?.requestRender();
      scheduleAutosave();
      notify('Холст очищен. Действие можно отменить сочетанием Ctrl+Z.');
    } else if (action.kind === 'resize') {
      // Размер меняется как обычный шаг истории: его можно отменить, обрезанное вернётся
      const next = buffer.resized(action.width, action.height);
      history.recordResize(buffer, next);
      setActiveBuffer(next);
      pushUndoEntry({ kind: 'pixels', boardId: activeBoardId });
      cursor = null;
      scheduleAutosave();
    } else {
      applyProject(action.project);
      notify(action.kind === 'image' ? 'Изображение импортировано.' : 'Проект открыт.');
    }
  }

  function cancelPending(): void {
    pending = null;
  }

  function describePending(action: PendingAction): { title: string; message: string; confirmText: string } {
    if (action.kind === 'clear') {
      return {
        title: 'Очистить холст?',
        message: 'Все пиксели будут удалены. Очистку можно отменить сочетанием Ctrl+Z.',
        confirmText: 'Очистить',
      };
    }

    if (action.kind === 'import') {
      const { width, height } = action.project;
      return {
        title: 'Открыть проект?',
        message: `Файл «${action.fileName}» (${width}×${height}) заменит текущий рисунок. История действий будет очищена, отменить замену нельзя.`,
        confirmText: 'Открыть',
      };
    }

    if (action.kind === 'image') {
      return {
        title: 'Импортировать изображение?',
        message: `Изображение «${action.fileName}» будет преобразовано в пиксельное изображение ${action.project.width}×${action.project.height} и заменит текущий рисунок. Продолжить?`,
        confirmText: 'Импортировать',
      };
    }

    const from = `${buffer.width}×${buffer.height}`;
    const to = `${action.width}×${action.height}`;
    const crops = action.width < buffer.width || action.height < buffer.height;
    let message = `Размер сетки изменится с ${from} на ${to}. Содержимое сохранится от левого верхнего угла.`;
    if (crops) message += ' Всё, что не поместится в новый размер, будет обрезано.';
    message += ' Изменение можно отменить (Ctrl+Z).';
    return { title: 'Изменить размер сетки?', message, confirmText: 'Изменить' };
  }

  // ——— Клавиатура ———

  function isTypingTarget(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  // Горячие клавиши по e.code: работают независимо от раскладки (в том числе русской)
  function onKeyDown(e: KeyboardEvent): void {
    if (pending || helpOpen || settingsOpen || isTypingTarget(e.target)) return;

    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.code === 'KeyY') {
        e.preventDefault();
        redo();
      } else if (e.code === 'KeyS') {
        e.preventDefault();
        if (!e.repeat) saveProject();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.code === 'Space') {
      // preventDefault: не прокручивать страницу и не нажимать сфокусированную кнопку
      e.preventDefault();
      spaceHeld = true;
      return;
    }

    if (e.repeat) return;

    if (e.code === 'KeyG') {
      toggleGrid();
      return;
    }
    if (e.code === 'KeyF') {
      fitCanvas();
      return;
    }
    if (e.code === 'KeyX') {
      swapColors();
      return;
    }
    if (e.code === 'KeyH' || e.code === 'F1') {
      e.preventDefault();
      helpOpen = true;
      return;
    }
    if (e.code === 'Equal' || e.code === 'NumpadAdd') {
      canvasApi?.zoomBy(1);
      return;
    }
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
      canvasApi?.zoomBy(-1);
      return;
    }

    const tool = TOOLS.find((t) => t.hotkeyCode === e.code);
    if (tool) {
      selectTool(tool.id);
      return;
    }

    const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
    if (digit) {
      const size = Number(digit[1]);
      if (size >= MIN_BRUSH_SIZE && size <= MAX_BRUSH_SIZE) setBrushSize(size);
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.code !== 'Space') return;
    spaceHeld = false;
    if (!pending && !helpOpen && !settingsOpen && !isTypingTarget(e.target)) e.preventDefault();
  }

  function onWindowBlur(): void {
    spaceHeld = false;
  }

  if (preferences.error) notify(preferences.error, 'error');
</script>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} onblur={onWindowBlur} onpagehide={flushAutosave} />
<svelte:document onvisibilitychange={onVisibilityChange} />

<div class="app">
  <ProjectBar
    {canUndo}
    {canRedo}
    {exportFormat}
    {exportScale}
    {availableExportScales}
    exportWidth={buffer.width * exportScale}
    exportHeight={buffer.height * exportScale}
    onundo={undo}
    onredo={redo}
    onopen={importProjectFile}
    onsave={saveProject}
    onexport={exportImage}
    onformat={(format) => (exportFormat = format)}
    onscale={(scale) => {
      if (availableExportScales.includes(scale)) exportScale = scale;
    }}
    onsettings={(trigger) => openSettings('general', trigger)}
    onhelp={(trigger) => {
      helpTrigger = trigger;
      helpOpen = true;
    }}
  />

  <Toolbar
    width={buffer.width}
    height={buffer.height}
    {showGrid}
    {customSizes}
    ontogglegrid={toggleGrid}
    onfit={fitCanvas}
    onzoomin={() => canvasApi?.zoomBy(1)}
    onzoomout={() => canvasApi?.zoomBy(-1)}
    onresize={requestResize}
    onsavesize={saveCurrentSize}
    onremovesize={removeCurrentSavedSize}
    onclear={requestClear}
  />

  <div class="body">
    <ToolPanel
      tools={TOOLS}
      {activeToolId}
      {brushSize}
      onselect={selectTool}
      onbrush={setBrushSize}
      onaddboard={addBoard}
    />

    <section class="workspace" aria-label="Холст">
      <Canvas
        bind:this={canvasApi}
        {buffer}
        bind:view
        bind:cursor
        {showGrid}
        {boards}
        {activeBoardId}
        {canvasBackground}
        {workspaceBackground}
        panMode={spaceHeld}
        tool={activeTool}
        {primary}
        {secondary}
        {brushSize}
        onpickcolor={setColor}
        onusecolor={rememberColor}
        onstrokebegin={beginStroke}
        onstrokeend={endStroke}
        onselectboard={selectBoard}
        onmoveboard={moveBoard}
      />
    </section>

    <PalettePanel
      palettes={PALETTES}
      {palette}
      {freeColor}
      {primary}
      {secondary}
      recent={visibleRecent}
      onpalette={selectPalette}
      onfreecolor={setFreeColor}
      onpick={setColor}
      onswap={swapColors}
    />
  </div>

  <StatusBar
    {cursor}
    width={buffer.width}
    height={buffer.height}
    zoom={view.zoom}
    toolLabel={activeTool.label}
    brushSize={activeTool.usesBrush ? brushSize : null}
    {saveStatus}
    {savedAt}
  />
</div>

{#if notice}
  <Toast message={notice.text} kind={notice.kind} onclose={dismissNotice} />
{/if}

{#if helpOpen}
  <HelpDialog tools={TOOLS} returnFocusTo={helpTrigger} onclose={() => (helpOpen = false)} />
{/if}

{#if settingsOpen}
<SettingsDialog
  {theme}
  initialTab={settingsTab}
  {canvasBackground}
  {workspaceBackground}
  returnFocusTo={settingsTrigger}
  ontheme={setTheme}
  oncanvasbackground={setCanvasBackground}
  onworkspacebackground={setWorkspaceBackground}
  onclose={() => (settingsOpen = false)}
/>
{/if}

{#if pending}
  {@const dialog = describePending(pending)}
  <ConfirmDialog
    title={dialog.title}
    message={dialog.message}
    confirmText={dialog.confirmText}
    cancelText="Отмена"
    onconfirm={confirmPending}
    oncancel={cancelPending}
  />
{/if}

<style>
  .app {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    height: 100%;
  }

  .body {
    display: flex;
    min-width: 0;
    min-height: 0;
  }

  /* Узкий экран: панель инструментов — полоса сверху, палитра — полоса снизу */
  @media (max-width: 859px) {
    .body {
      flex-direction: column;
    }
  }

  .workspace {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
</style>
