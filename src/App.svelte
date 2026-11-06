<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import Canvas, { type ViewportGuide } from './components/Canvas.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import HelpDialog from './components/HelpDialog.svelte';
  import SettingsDialog from './components/SettingsDialog.svelte';
  import ReferencesPanel from './components/ReferencesPanel.svelte';
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
  import {
    MAX_PROJECT_REFERENCES,
    MAX_REFERENCE_TOTAL_PIXELS,
    MAX_REFERENCE_SCALE,
    MIN_REFERENCE_SCALE,
    applyReferencesToBuffer,
    type ReferenceImage,
  } from './core/reference';
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
    MAX_PROJECT_LAYERS,
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
    saveGridMode,
    saveGridSpacing,
    saveSnapToGrid,
    saveCheckerboard,
    saveCustomSizes,
    saveThemePreference,
    currentSizeIsBuiltIn,
    MAX_CUSTOM_SIZES,
    type CanvasSize,
    type GridMode,
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
  import {
    compositeLayers,
    createRasterLayer,
    updateRasterLayer,
    type RasterLayer,
    type LayerGroup,
    type LayerBlendMode,
    type LayerUpdate,
    type LayerGroupUpdate,
    createLayerGroup,
    updateLayerGroup,
    MAX_GROUP_COMPOSITE_PIXELS,
  } from './core/layers';
  import {
    clearSelection,
    combineSelections,
    copySelection,
    createOpaqueSelection,
    createRectSelection,
    flipClipboard,
    integerScaleClipboard,
    invertSelection,
    moveSelection,
    pasteClipboard,
    rotateClipboard,
    scaleClipboard,
    selectionBounds,
    type PixelClipboard,
    type SelectionMask,
    type SelectionMode,
    type SelectionOperation,
  } from './core/selection';
  import { getBrowserStorage, type SaveStatus } from './core/storage';
  import type { StrokeOutcome } from './core/stroke';
  import {
    MAX_BRUSH_SIZE,
    MIN_BRUSH_SIZE,
    TOOLS,
    clampBrushSize,
    getTool,
    createBrushDefinition,
    parseBrushDefinition,
    parseBrushLibrary,
    serializeBrushLibrary,
    type BrushShape,
    type BrushDefinition,
    type BrushType,
    type DrawingSettings,
    type ToolId,
  } from './core/tools';
  import type { PixelPos, ViewState } from './core/viewport';
  import type { SelectionAction } from './components/ToolPanel.svelte';

  interface Props {
    initialProject: ProjectData | null;
    initialLoadError: string | null;
    initialStorageMode: AutosaveStorageMode;
    autosaveRepository: AutosaveRepository;
  }

  function setBrushShape(shape: BrushShape): void {
    brushShape = shape;
    selectedBrushId = '';
  }

  function updateDrawingSettings(next: DrawingSettings): void {
    drawingSettings = next;
  }

  function updateBrush(brush: BrushDefinition): void {
    const validated = parseBrushDefinition(brush);
    brushLibrary = brushLibrary.map((entry) => entry.id === validated.id ? validated : entry);
    persistBrushLibrary();
  }

  function persistBrushLibrary(): void {
    if (!storage) {
      notify('Библиотека кистей недоступна: браузер не разрешил доступ к локальному хранилищу.', 'error');
      return;
    }
    try {
      storage.setItem(BRUSH_LIBRARY_KEY, serializeBrushLibrary(brushLibrary));
    } catch (error) {
      notify(`Не удалось сохранить библиотеку кистей: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  function saveBrush(name: string, type: BrushType): void {
    const brush = createBrushDefinition(name, brushSize, brushShape, type);
    const existing = brushLibrary.findIndex((entry) => entry.name.toLowerCase() === brush.name.toLowerCase());
    if (existing >= 0) brushLibrary = brushLibrary.map((entry, index) => index === existing ? brush : entry);
    else if (brushLibrary.length < 64) brushLibrary = [...brushLibrary, brush];
    else {
      notify('Библиотека кистей заполнена (максимум 64 кисти).', 'error');
      return;
    }
    selectedBrushId = brush.id;
    persistBrushLibrary();
  }

  function selectBrush(id: string): void {
    selectedBrushId = id;
    const brush = brushLibrary.find((entry) => entry.id === id);
    if (!brush) return;
    brushSize = brush.size;
    brushShape = brush.type === 'circle' ? 'circle' : 'square';
  }

  function removeBrush(): void {
    if (!selectedBrushId) return;
    brushLibrary = brushLibrary.filter((brush) => brush.id !== selectedBrushId);
    selectedBrushId = '';
    persistBrushLibrary();
  }

  function importBrushLibrary(incoming: readonly BrushDefinition[]): void {
    const merged = [...brushLibrary];
    for (const brush of incoming) {
      const byId = merged.findIndex((entry) => entry.id === brush.id);
      const byName = merged.findIndex((entry) => entry.name.toLowerCase() === brush.name.toLowerCase());
      const index = byId >= 0 ? byId : byName;
      if (index >= 0) merged[index] = brush;
      else if (merged.length < 64) merged.push(brush);
    }
    brushLibrary = merged;
    persistBrushLibrary();
    notify(`Импортировано кистей: ${incoming.length}.`);
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
    layers: RasterLayer[];
    groups: LayerGroup[];
    groupBuffers: Map<string, PixelBuffer>;
    activeLayerId: string;
    buffer: PixelBuffer;
  }

  type BoardAction =
    | { kind: 'add'; board: Artboard; index: number; previousActiveBoardId: string }
    | {
        kind: 'move';
        before: Array<{ id: string; x: number; y: number }>;
        after: Array<{ id: string; x: number; y: number }>;
      };
  type UndoEntry =
    | { kind: 'pixels'; boardId: string; historyKey: string }
    | {
        kind: 'selection-pixels';
        boardId: string;
        historyKey: string;
        beforeSelection: SelectionMask | null;
        afterSelection: SelectionMask | null;
      }
    | {
        kind: 'layer-stack';
        boardId: string;
        beforeLayers: RasterLayer[];
        afterLayers: RasterLayer[];
        beforeGroups: LayerGroup[];
        afterGroups: LayerGroup[];
        beforeActiveLayerId: string;
        afterActiveLayerId: string;
        beforeSelection?: SelectionMask | null;
        afterSelection?: SelectionMask | null;
      }
    | { kind: 'references'; before: ReferenceImage[]; after: ReferenceImage[] }
    | { kind: 'board'; action: BoardAction };

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

  function makeArtboard(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    pixels: Uint8ClampedArray,
    sourceLayers?: NonNullable<ProjectData['canvases']>[number]['layers'],
    sourceActiveLayerId?: string,
    sourceGroups: LayerGroup[] = [],
  ): Artboard {
    const layers = (sourceLayers?.map((source) => {
      const layer = createRasterLayer(source.id, source.name, width, height, source.pixels);
      const restored = updateRasterLayer(layer, {
        visible: source.visible,
        locked: source.locked,
        alphaLock: source.alphaLock,
        opacity: source.opacity,
        blendMode: source.blendMode,
        clippingMask: source.clippingMask,
        role: source.role ?? 'paint',
        effects: source.effects,
        filters: source.filters,
        groupId: source.groupId ?? null,
      });
      restored.buffer.setLocked(restored.locked || groupHasLock(sourceGroups, restored.groupId));
      restored.buffer.setAlphaLock(restored.alphaLock);
      return restored;
    }) ?? [createRasterLayer(`${id}-layer-1`, 'Слой 1', width, height, pixels)]).sort((a, b) =>
      Number(a.role !== 'background') - Number(b.role !== 'background'));
    const activeLayerId = layers.some((layer) => layer.id === sourceActiveLayerId)
      ? sourceActiveLayerId!
      : layers[0]!.id;
    const groups = sourceGroups.map((group) => ({ ...group }));
    const groupBuffers = new Map<string, PixelBuffer>();
    const composite = compositeLayers(width, height, layers, undefined, undefined, groups, groupBuffers);
    for (const layer of layers) layer.buffer.takeDirty();
    return { id, x, y, layers, groups, groupBuffers, activeLayerId, buffer: composite };
  }

  const initialBoards: Artboard[] = start?.canvases
    ? start.canvases.map((canvas) => makeArtboard(
        canvas.id, canvas.x, canvas.y, canvas.width, canvas.height, canvas.pixels, canvas.layers, canvas.activeLayerId,
        canvas.groups,
      ))
    : [makeArtboard(
        start?.activeCanvasId ?? 'canvas-1',
        0,
        0,
        start?.width ?? DEFAULT_GRID_SIZE,
        start?.height ?? DEFAULT_GRID_SIZE,
        start?.pixels ?? new Uint8ClampedArray(DEFAULT_GRID_SIZE * DEFAULT_GRID_SIZE * 4),
      )];
  const bufferHistoryIds = new WeakMap<PixelBuffer, number>();
  let nextBufferHistoryId = 1;
  function getHistoryKey(boardId: string, layer: RasterLayer): string {
    let historyId = bufferHistoryIds.get(layer.buffer);
    if (!historyId) {
      historyId = nextBufferHistoryId++;
      bufferHistoryIds.set(layer.buffer, historyId);
    }
    return `${boardId}:${historyId}`;
  }
  const histories = new Map(initialBoards.flatMap((board) =>
    board.layers.map((layer) => [getHistoryKey(board.id, layer), new History()] as const),
  ));
  const undoTimeline: UndoEntry[] = [];
  const redoTimeline: UndoEntry[] = [];
  const initialActiveBoardId = start?.activeCanvasId ?? initialBoards[0]!.id;
  const initialActiveBoard = initialBoards.find((board) => board.id === initialActiveBoardId)!;
  const initialActiveLayer = initialActiveBoard.layers.find((layer) => layer.id === initialActiveBoard.activeLayerId)!;
  let history = histories.get(getHistoryKey(initialActiveBoardId, initialActiveLayer))!;
  let boards = $state.raw<Artboard[]>(initialBoards);
  let activeBoardId = $state(initialActiveBoardId);
  let activeLayerId = $state(initialActiveBoard.activeLayerId);
  let buffer = $state.raw(initialActiveBoard.layers.find((layer) => layer.id === activeLayerId)!.buffer);
  let references = $state.raw<ReferenceImage[]>(start?.references?.map((reference) => ({ ...reference })) ?? []);
  let selectedReferenceId = $state<string | null>(start?.references?.[0]?.id ?? null);
  let referencesOpen = $state(false);
  let includeReferencesInExport = $state(false);
  let referenceMoveSnapshot: ReferenceImage[] | null = null;
  let view = $state.raw<ViewState>({ zoom: 1, offsetX: 0, offsetY: 0 });
  let cursor = $state.raw<PixelPos | null>(null);
  let showGrid = $state(true);
  let gridMode = $state<GridMode>(preferences.gridMode);
  let gridSpacing = $state(preferences.gridSpacing);
  let snapToGrid = $state(preferences.snapToGrid);
  let checkerboard = $state(preferences.checkerboard);
  let tiledMode = $state(false);
  let symmetryX = $state(false);
  let symmetryY = $state(false);
  let guides = $state.raw<ViewportGuide[]>([]);
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
  let layerSequence = 1;

  let activeToolId = $state<ToolId>('pencil');
  let selectionMask = $state.raw<SelectionMask | null>(null);
  let selectionMode = $state<SelectionMode | null>(null);
  let selectionOperation = $state<SelectionOperation>('replace');
  let selectionClipboard = $state.raw<PixelClipboard | null>(null);
  let selectionPreview = $state.raw<{
    clipboard: PixelClipboard;
    x: number;
    y: number;
    selection: SelectionMask;
    preview: PixelBuffer;
  } | null>(null);
  let brushSize = $state(MIN_BRUSH_SIZE);
  let brushShape = $state<BrushShape>('square');
  let brushOpacity = $state(100);
  const BRUSH_LIBRARY_KEY = 'pixel-editor:brush-library';
  let brushLibrary = $state.raw<BrushDefinition[]>([]);
  let selectedBrushId = $state('');
  let brushLibraryError: string | null = null;
  let temporaryPicker = $state(false);
  let drawingSettings = $state<DrawingSettings>({
    pixelPerfect: false,
    lineAngleSnap: 0,
    fillContiguous: true,
    fillTolerance: 0,
    fillConnectivity: 4,
    fillProtectAlpha: false,
    sampleMerged: false,
    pickerRadius: 1,
    polygonSides: 6,
    gradientKind: 'linear',
    gradientDither: false,
    gradientTransparency: false,
    gradientMidpointEnabled: false,
    gradientMidpoint: { r: 128, g: 128, b: 128, a: 255 },
    gradientMidpointPosition: 50,
    ditherPattern: 'bayer4',
    ditherDensity: 0.5,
    ditherScale: 1,
    ditherAngle: 0,
    ditherCustomPattern: '01/10',
  });

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
  const activeBoard = $derived(boards.find((board) => board.id === activeBoardId) ?? boards[0]!);
  const activeLayers = $derived(activeBoard.layers);
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
      references,
      canvases: boards.map((board) => ({
        id: board.id,
        x: board.x,
        y: board.y,
        width: board.buffer.width,
        height: board.buffer.height,
        pixels: board.buffer.data,
        activeLayerId: board.activeLayerId,
        layers: board.layers.map((layer) => ({
          id: layer.id,
          name: layer.name,
          pixels: layer.buffer.data,
          visible: layer.visible,
          locked: layer.locked,
          opacity: layer.opacity,
          blendMode: layer.blendMode,
          alphaLock: layer.alphaLock,
          clippingMask: layer.clippingMask,
          role: layer.role ?? 'paint',
          effects: layer.effects,
          filters: layer.filters,
          groupId: layer.groupId ?? null,
        })),
        groups: board.groups,
      })),
      activeCanvasId: activeBoardId,
    };
  }

  function groupHasLock(groups: readonly LayerGroup[], groupId: string | null | undefined): boolean {
    const byId = new Map(groups.map((group) => [group.id, group]));
    let currentId = groupId;
    while (currentId) {
      const current = byId.get(currentId);
      if (!current) return false;
      if (current.locked) return true;
      currentId = current.parentGroupId;
    }
    return false;
  }

  function replaceLayerStack(
    boardId: string,
    layers: RasterLayer[],
    nextActiveLayerId: string,
    groups?: LayerGroup[],
  ): void {
    const board = boards.find((entry) => entry.id === boardId);
    if (!board || !layers.some((layer) => layer.id === nextActiveLayerId)) {
      throw new RangeError('Layer stack must contain its active layer.');
    }
    const nextGroups = (groups ?? board.groups).map((group) => ({ ...group }));
    const activeGroupIds = new Set(nextGroups.map((group) => group.id));
    for (const groupId of board.groupBuffers.keys()) {
      if (!activeGroupIds.has(groupId)) board.groupBuffers.delete(groupId);
    }
    const nextLayers = [
      ...layers.filter((layer) => layer.role === 'background'),
      ...layers.filter((layer) => layer.role !== 'background'),
    ].map((layer) => ({ ...layer }));
    for (const layer of nextLayers) {
      layer.buffer.setLocked(layer.locked || groupHasLock(nextGroups, layer.groupId));
      layer.buffer.setAlphaLock(layer.alphaLock);
    }
    const composite = compositeLayers(
      nextLayers[0]!.buffer.width,
      nextLayers[0]!.buffer.height,
      nextLayers,
      undefined,
      undefined,
      nextGroups,
      board.groupBuffers,
    );
    for (const layer of nextLayers) layer.buffer.takeDirty();
    boards = boards.map((entry) => entry.id === boardId
      ? { ...entry, layers: nextLayers, groups: nextGroups, activeLayerId: nextActiveLayerId, buffer: composite }
      : entry);
    if (activeBoardId === boardId) {
      activeLayerId = nextActiveLayerId;
      buffer = nextLayers.find((layer) => layer.id === nextActiveLayerId)!.buffer;
      const activeLayer = nextLayers.find((layer) => layer.id === nextActiveLayerId)!;
      buffer.setLocked(activeLayer.locked || groupHasLock(nextGroups, activeLayer.groupId));
      const key = getHistoryKey(boardId, activeLayer);
      history = histories.get(key) ?? new History();
      histories.set(key, history);
      buffer.setClipMask(selectionMask?.data ?? null);
      canvasApi?.requestRender();
    }
  }

  function getActiveLayer(): RasterLayer {
    const layer = boards.find((board) => board.id === activeBoardId)?.layers.find((entry) => entry.id === activeLayerId);
    if (!layer) throw new Error('Активный слой не найден.');
    return layer;
  }

  function refreshComposite(boardId: string, changedLayer?: RasterLayer): void {
    const board = boards.find((entry) => entry.id === boardId);
    if (!board) return;
    const sourceLayer = changedLayer ??
      board.layers.find((layer) => layer.id === board.activeLayerId);
    const dirty = sourceLayer?.buffer.takeDirty();
    if (!sourceLayer || !dirty) return;
    compositeLayers(
      sourceLayer.buffer.width,
      sourceLayer.buffer.height,
      board.layers,
      board.buffer,
      dirty,
      board.groups,
      board.groupBuffers,
    );
    if (activeBoardId === boardId) canvasApi?.requestRender();
  }

  function applyLayerStackAction(entry: Extract<UndoEntry, { kind: 'layer-stack' }>, direction: 'undo' | 'redo'): void {
    if (activeBoardId !== entry.boardId) setActiveBoard(entry.boardId);
    const layers = direction === 'undo' ? entry.beforeLayers : entry.afterLayers;
    const groups = direction === 'undo' ? entry.beforeGroups : entry.afterGroups;
    const layerId = direction === 'undo' ? entry.beforeActiveLayerId : entry.afterActiveLayerId;
    replaceLayerStack(entry.boardId, layers, layerId, groups);
    if (entry.beforeSelection !== undefined || entry.afterSelection !== undefined) {
      setSelection(direction === 'undo' ? entry.beforeSelection ?? null : entry.afterSelection ?? null);
    }
    scheduleAutosave();
  }

  function selectBoard(id: string): void {
    const board = boards.find((entry) => entry.id === id);
    if (!board || id === activeBoardId) return;
    selectionPreview = null;
    buffer.setClipMask(null);
    selectionMask = null;
    activeBoardId = id;
    activeLayerId = board.activeLayerId;
    const layer = board.layers.find((entry) => entry.id === activeLayerId)!;
    buffer = layer.buffer;
    buffer.setClipMask(null);
    const key = getHistoryKey(id, layer);
    history = histories.get(key) ?? new History();
    histories.set(key, history);
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

  function moveBoards(positions: Array<{ id: string; x: number; y: number }>): void {
    if (positions.length <= 1) {
      const position = positions[0];
      if (position) moveBoard(position.id, position.x, position.y);
      return;
    }
    if (positions.some((position) =>
      !Number.isSafeInteger(position.x) ||
      !Number.isSafeInteger(position.y) ||
      Math.abs(position.x) > MAX_PROJECT_CANVAS_COORDINATE ||
      Math.abs(position.y) > MAX_PROJECT_CANVAS_COORDINATE
    )) {
      notify('Холсты нельзя переместить за пределы рабочего поля.', 'error');
      return;
    }
    const changes = new Map(positions.map((position) => [position.id, position]));
    const before = boards
      .filter((board) => changes.has(board.id))
      .map((board) => ({ id: board.id, x: board.x, y: board.y }));
    const after = before.map((position) => {
      const next = changes.get(position.id)!;
      return { id: position.id, x: next.x, y: next.y };
    });
    if (before.length < 2 || before.every((position, index) =>
      position.x === after[index]!.x && position.y === after[index]!.y
    )) return;
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
    const totalPixels = getTotalLayerPixels();
    if (totalPixels + buffer.width * buffer.height > MAX_PROJECT_TOTAL_PIXELS) {
      notify(
        `Общая площадь холстов не может превышать ${MAX_PROJECT_TOTAL_PIXELS.toLocaleString('ru-RU')} пикселей.`,
        'error',
      );
      return;
    }
    buffer.setClipMask(null);
    selectionMask = null;
    selectionPreview = null;
    const previousActiveBoardId = activeBoardId;
    const activeBoard = boards.find((board) => board.id === activeBoardId) ?? boards[0]!;
    const position = findBoardPosition(buffer.width, buffer.height, activeBoard);
    if (!position) {
      notify('Не удалось найти свободное место рядом с рабочей областью.', 'error');
      return;
    }
    const id = `canvas-${Date.now().toString(36)}-${boardSequence++}`;
    const newLayer = createRasterLayer(`${id}-layer-1`, 'Слой 1', buffer.width, buffer.height);
    const board: Artboard = {
      id,
      ...position,
      layers: [newLayer],
      groups: [],
      groupBuffers: new Map(),
      activeLayerId: newLayer.id,
      buffer: compositeLayers(buffer.width, buffer.height, [newLayer], undefined, undefined, [], new Map()),
    };
    newLayer.buffer.takeDirty();
    const index = boards.length;
    boards = [...boards, board];
    activeBoardId = id;
    activeLayerId = board.activeLayerId;
    buffer = board.layers.find((layer) => layer.id === activeLayerId)!.buffer;
    history = new History();
    histories.set(getHistoryKey(id, board.layers.find((layer) => layer.id === activeLayerId)!), history);
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
    void references;
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
    if (entry.kind === 'pixels' || entry.kind === 'selection-pixels') {
      const historyCount = histories.get(entry.historyKey)?.undoCount ?? 0;
      let timelineCount = undoTimeline.filter(
        (candidate) =>
          (candidate.kind === 'pixels' || candidate.kind === 'selection-pixels') &&
          candidate.historyKey === entry.historyKey,
      ).length;
      while (timelineCount > historyCount) {
        const oldestIndex = undoTimeline.findIndex(
          (candidate) =>
            (candidate.kind === 'pixels' || candidate.kind === 'selection-pixels') &&
            candidate.historyKey === entry.historyKey,
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
    selectionPreview = null;
    buffer.setClipMask(null);
    selectionMask = null;
    activeBoardId = id;
    activeLayerId = board.activeLayerId;
    const layer = board.layers.find((entry) => entry.id === activeLayerId)!;
    buffer = layer.buffer;
    buffer.setLocked(layer.locked || groupHasLock(board.groups, layer.groupId));
    buffer.setClipMask(null);
    const key = getHistoryKey(id, layer);
    history = histories.get(key) ?? new History();
    histories.set(key, history);
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
      refreshComposite(activeBoardId, getActiveLayer());
      return;
    }
    if (history.commit(buffer)) {
      pushUndoEntry({
        kind: 'pixels',
        boardId: activeBoardId,
        historyKey: getHistoryKey(activeBoardId, getActiveLayer()),
      });
      scheduleAutosave();
    }
    refreshComposite(activeBoardId, getActiveLayer());
  }

  /** Применяет результат undo/redo к указанному холсту. */
  function applyHistoryResult(next: PixelBuffer | null, boardId: string, historyKey: string): boolean {
    if (!next) return false;
    const target = boards.find((board) => board.id === boardId);
    if (!target) return false;
    const layer = target.layers.find((item) => getHistoryKey(boardId, item) === historyKey);
    if (!layer) return false;
    if (next !== layer.buffer) {
      const layers = target.layers.map((item) => item === layer ? { ...item, buffer: next } : item);
      replaceLayerStack(boardId, layers, target.activeLayerId);
      if (activeBoardId === boardId && activeLayerId === layer.id) buffer = next;
      if (activeBoardId === boardId) cursor = null;
    } else {
      refreshComposite(boardId, layer);
    }
    scheduleAutosave();
    return true;
  }

  function undo(): void {
    const entry = undoTimeline.pop();
    if (!entry) return;
    if (entry.kind === 'board') {
      applyBoardAction(entry.action, 'undo');
    } else if (entry.kind === 'layer-stack') {
      applyLayerStackAction(entry, 'undo');
    } else if (entry.kind === 'references') {
      references = entry.before.map((reference) => ({ ...reference }));
      if (!references.some((reference) => reference.id === selectedReferenceId)) {
        selectedReferenceId = references[0]?.id ?? null;
      }
      scheduleAutosave();
    } else {
      const target = boards.find((board) => board.id === entry.boardId);
      const targetHistory = histories.get(entry.historyKey);
      if (!target || !targetHistory) {
        undoTimeline.push(entry);
        return;
      }
      if (activeBoardId !== entry.boardId) setActiveBoard(entry.boardId);
      const targetLayer = target.layers.find((layer) => getHistoryKey(entry.boardId, layer) === entry.historyKey);
      if (!targetLayer || !applyHistoryResult(targetHistory.undo(targetLayer.buffer), entry.boardId, entry.historyKey)) {
        undoTimeline.push(entry);
        return;
      }
      if (entry.kind === 'selection-pixels' && activeBoardId === entry.boardId) {
        setSelection(entry.beforeSelection);
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
    } else if (entry.kind === 'layer-stack') {
      applyLayerStackAction(entry, 'redo');
    } else if (entry.kind === 'references') {
      references = entry.after.map((reference) => ({ ...reference }));
      if (!references.some((reference) => reference.id === selectedReferenceId)) {
        selectedReferenceId = references[0]?.id ?? null;
      }
      scheduleAutosave();
    } else {
      const target = boards.find((board) => board.id === entry.boardId);
      const targetHistory = histories.get(entry.historyKey);
      if (!target || !targetHistory) {
        redoTimeline.push(entry);
        return;
      }
      if (activeBoardId !== entry.boardId) setActiveBoard(entry.boardId);
      const targetLayer = target.layers.find((layer) => getHistoryKey(entry.boardId, layer) === entry.historyKey);
      if (!targetLayer || !applyHistoryResult(targetHistory.redo(targetLayer.buffer), entry.boardId, entry.historyKey)) {
        redoTimeline.push(entry);
        return;
      }
      if (entry.kind === 'selection-pixels' && activeBoardId === entry.boardId) {
        setSelection(entry.afterSelection);
      }
    }
    undoTimeline.push(entry);
    syncHistory();
  }

  // ——— Инструменты и цвета ———

  function toggleGrid(): void {
    showGrid = !showGrid;
  }

  function setGridMode(mode: GridMode): void {
    if (mode === gridMode) return;
    gridMode = mode;
    if (!saveGridMode(storage, mode)) notify('Режим сетки применён, но сохранить настройку не удалось.', 'error');
  }

  function setGridSpacing(spacing: number): void {
    if (spacing === gridSpacing) return;
    gridSpacing = spacing;
    if (!saveGridSpacing(storage, spacing)) notify('Шаг сетки применён, но сохранить настройку не удалось.', 'error');
  }

  function setSnapToGrid(enabled: boolean): void {
    if (enabled === snapToGrid) return;
    snapToGrid = enabled;
    if (!saveSnapToGrid(storage, enabled)) notify('Привязка включена до закрытия страницы, но не сохранена.', 'error');
  }

  function setCheckerboard(enabled: boolean): void {
    if (enabled === checkerboard) return;
    checkerboard = enabled;
    if (!saveCheckerboard(storage, enabled)) notify('Фон применён до закрытия страницы, но настройка не сохранена.', 'error');
  }

  function updateGuides(next: ViewportGuide[]): void {
    guides = next;
  }

  function openPreviewWindow(): void {
    try {
      canvasApi?.openPreviewWindow();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось открыть окно предпросмотра.', 'error');
    }
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
    if (buffer.isLocked || buffer.isAlphaLocked) {
      notify(buffer.isLocked ? 'Активный слой заблокирован.' : 'Отключите Alpha Lock, чтобы очистить слой.', 'error');
      return;
    }
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

  function getTotalLayerPixels(): number {
    return boards.reduce(
      (total, board) => total + board.layers.reduce((count, layer) => count + layer.buffer.width * layer.buffer.height, 0),
      0,
    );
  }

  function commitLayerStack(
    boardId: string,
    layers: RasterLayer[],
    nextActiveLayerId: string,
    beforeSelection: SelectionMask | null = selectionMask,
    afterSelection: SelectionMask | null = selectionMask,
    groups?: LayerGroup[],
  ): void {
    const board = boards.find((entry) => entry.id === boardId);
    if (!board) return;
    const afterLayers = [
      ...layers.filter((layer) => layer.role === 'background'),
      ...layers.filter((layer) => layer.role !== 'background'),
    ];
    const afterGroups = groups ?? board.groups;
    if (
      afterLayers.length === board.layers.length &&
      afterLayers.every((layer, index) => layer === board.layers[index]) &&
      afterGroups.length === board.groups.length &&
      afterGroups.every((group, index) => group === board.groups[index]) &&
      nextActiveLayerId === board.activeLayerId &&
      beforeSelection === afterSelection
    ) return;
    const action: Extract<UndoEntry, { kind: 'layer-stack' }> = {
      kind: 'layer-stack',
      boardId,
      beforeLayers: board.layers,
      afterLayers,
      beforeGroups: board.groups,
      afterGroups,
      beforeActiveLayerId: board.activeLayerId,
      afterActiveLayerId: nextActiveLayerId,
      beforeSelection,
      afterSelection,
    };
    replaceLayerStack(boardId, afterLayers, nextActiveLayerId, afterGroups);
    pushUndoEntry(action);
    scheduleAutosave();
  }

  function selectLayer(id: string): void {
    const board = boards.find((entry) => entry.id === activeBoardId);
    if (!board || id === board.activeLayerId || !board.layers.some((layer) => layer.id === id)) return;
    const key = getHistoryKey(activeBoardId, board.layers.find((layer) => layer.id === id)!);
    if (!histories.has(key)) histories.set(key, new History());
    commitLayerStack(activeBoardId, board.layers, id);
  }

  function addLayer(): void {
    const board = boards.find((entry) => entry.id === activeBoardId)!;
    if (board.layers.length >= MAX_PROJECT_LAYERS) {
      notify(`На холсте может быть не больше ${MAX_PROJECT_LAYERS} слоёв.`, 'error');
      return;
    }
    const totalPixels = getTotalLayerPixels();
    if (totalPixels + buffer.width * buffer.height > MAX_PROJECT_TOTAL_PIXELS) {
      notify('Превышен лимит общего объёма пиксельных данных проекта.', 'error');
      return;
    }
    const id = `${activeBoardId}-layer-${Date.now().toString(36)}-${layerSequence++}`;
    const layer = createRasterLayer(id, `Слой ${board.layers.length + 1}`, buffer.width, buffer.height);
    const layers = [...board.layers, layer];
    histories.set(getHistoryKey(activeBoardId, layer), new History());
    commitLayerStack(activeBoardId, layers, id);
  }

  function addLayerGroup(): void {
    const board = boards.find((entry) => entry.id === activeBoardId)!;
    if (board.groups.length >= MAX_PROJECT_LAYERS) {
      notify(`На холсте может быть не больше ${MAX_PROJECT_LAYERS} групп.`, 'error');
      return;
    }
    const allocatedGroupPixels = boards.reduce(
      (total, entry) => total + entry.groups.length * entry.buffer.width * entry.buffer.height,
      0,
    );
    if (allocatedGroupPixels + buffer.width * buffer.height > MAX_GROUP_COMPOSITE_PIXELS) {
      notify('Превышен лимит памяти для композиции групп. Уменьшите холст или удалите группы.', 'error');
      return;
    }
    const activeLayer = board.layers.find((layer) => layer.id === board.activeLayerId)!;
    const id = `${activeBoardId}-group-${Date.now().toString(36)}-${layerSequence++}`;
    let number = board.groups.length + 1;
    while (board.groups.some((group) => group.name === `Группа ${number}`)) number++;
    const group = createLayerGroup(id, `Группа ${number}`, activeLayer.groupId ?? null);
    const groups = [...board.groups, group];
    const layers = board.layers.map((layer) => layer.id === activeLayer.id ? { ...layer, groupId: id } : layer);
    commitLayerStack(activeBoardId, layers, board.activeLayerId, selectionMask, selectionMask, groups);
  }

  function updateGroup(id: string, update: LayerGroupUpdate): void {
    const board = boards.find((entry) => entry.id === activeBoardId)!;
    try {
      const groups = board.groups.map((group) => group.id === id ? updateLayerGroup(group, update) : group);
      if (groups.every((group, index) => group === board.groups[index])) return;
      commitLayerStack(activeBoardId, board.layers, board.activeLayerId, selectionMask, selectionMask, groups);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  function deleteGroup(id: string): void {
    const board = boards.find((entry) => entry.id === activeBoardId)!;
    const group = board.groups.find((entry) => entry.id === id);
    if (!group) return;
    const groups = board.groups
      .filter((entry) => entry.id !== id)
      .map((entry) => entry.parentGroupId === id ? { ...entry, parentGroupId: group.parentGroupId } : entry);
    const layers = board.layers.map((layer) => layer.groupId === id
      ? { ...layer, groupId: group.parentGroupId }
      : layer);
    commitLayerStack(activeBoardId, layers, board.activeLayerId, selectionMask, selectionMask, groups);
  }

  function addSpecialLayer(role: 'background' | 'reference'): void {
    const board = boards.find((entry) => entry.id === activeBoardId)!;
    if (board.layers.length >= MAX_PROJECT_LAYERS) {
      notify(`На холсте может быть не больше ${MAX_PROJECT_LAYERS} слоёв.`, 'error');
      return;
    }
    if (getTotalLayerPixels() + buffer.width * buffer.height > MAX_PROJECT_TOTAL_PIXELS) {
      notify('Превышен лимит общего объёма пиксельных данных проекта.', 'error');
      return;
    }
    const id = `${activeBoardId}-${role}-${Date.now().toString(36)}-${layerSequence++}`;
    let pixels: Uint8ClampedArray | undefined;
    if (role === 'reference') {
      pixels = board.buffer.data.slice();
    } else {
      const color = { r: 255, g: 255, b: 255, a: 255 };
      pixels = new Uint8ClampedArray(buffer.width * buffer.height * 4);
      for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([color.r, color.g, color.b, color.a], offset);
    }
    const layer = updateRasterLayer(
      createRasterLayer(id, role === 'background' ? 'Фон' : 'Референс', buffer.width, buffer.height, pixels),
      { role },
    );
    const layers = role === 'background' ? [layer, ...board.layers] : [...board.layers, layer];
    histories.set(getHistoryKey(activeBoardId, layer), new History());
    commitLayerStack(activeBoardId, layers, layer.id);
  }

  function duplicateLayer(id: string): void {
    const board = boards.find((entry) => entry.id === activeBoardId)!;
    const source = board.layers.find((layer) => layer.id === id);
    if (!source) return;
    if (board.layers.length >= MAX_PROJECT_LAYERS) {
      notify(`На холсте может быть не больше ${MAX_PROJECT_LAYERS} слоёв.`, 'error');
      return;
    }
    if (getTotalLayerPixels() + buffer.width * buffer.height > MAX_PROJECT_TOTAL_PIXELS) {
      notify('Превышен лимит общего объёма пиксельных данных проекта.', 'error');
      return;
    }
    const idCopy = `${activeBoardId}-layer-${Date.now().toString(36)}-${layerSequence++}`;
    const copied = updateRasterLayer(
      createRasterLayer(idCopy, `${source.name} — копия`, source.buffer.width, source.buffer.height, source.buffer.data.slice()),
      {
        visible: source.visible,
        locked: false,
        opacity: source.opacity,
        blendMode: source.blendMode,
        alphaLock: source.alphaLock,
        clippingMask: source.clippingMask,
        role: source.role ?? 'paint',
        effects: source.effects,
        filters: source.filters,
      },
    );
    const position = board.layers.findIndex((layer) => layer.id === id);
    const layers = [...board.layers.slice(0, position + 1), copied, ...board.layers.slice(position + 1)];
    histories.set(getHistoryKey(activeBoardId, copied), new History());
    commitLayerStack(activeBoardId, layers, copied.id);
  }

  function deleteLayer(id: string): void {
    const board = boards.find((entry) => entry.id === activeBoardId)!;
    if (board.layers.length <= 1) {
      notify('На холсте должен остаться хотя бы один слой.', 'error');
      return;
    }
    const index = board.layers.findIndex((layer) => layer.id === id);
    if (index < 0) return;
    const layers = board.layers.filter((layer) => layer.id !== id);
    const nextActive = id === board.activeLayerId
      ? layers[Math.min(index, layers.length - 1)]!.id
      : board.activeLayerId;
    commitLayerStack(activeBoardId, layers, nextActive);
  }

  function moveLayer(id: string, direction: -1 | 1): void {
    const board = boards.find((entry) => entry.id === activeBoardId)!;
    const index = board.layers.findIndex((layer) => layer.id === id);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= board.layers.length) return;
    const layers = [...board.layers];
    [layers[index], layers[destination]] = [layers[destination]!, layers[index]!];
    commitLayerStack(activeBoardId, layers, board.activeLayerId);
  }

  function reorderLayers(sourceId: string, targetId: string): void {
    const board = boards.find((entry) => entry.id === activeBoardId)!;
    const sourceIndex = board.layers.findIndex((layer) => layer.id === sourceId);
    const targetIndex = board.layers.findIndex((layer) => layer.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const layers = [...board.layers];
    const [source] = layers.splice(sourceIndex, 1);
    layers.splice(targetIndex, 0, source!);
    commitLayerStack(activeBoardId, layers, board.activeLayerId);
  }

  function updateLayer(id: string, update: LayerUpdate): void {
    const board = boards.find((entry) => entry.id === activeBoardId)!;
    try {
      const layers = board.layers.map((layer) => layer.id === id
        ? updateRasterLayer(layer, update.role === 'background' ? { ...update, groupId: null } : update)
        : layer);
      if (layers.every((layer, index) => layer === board.layers[index])) return;
      commitLayerStack(activeBoardId, layers, board.activeLayerId);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  function getLayersFromSelection(): void {
    if (!selectionMask) return;
    const selectionSource = drawingSettings.sampleMerged ? activeBoard.buffer : buffer;
    const clipboard = copySelection(selectionSource, selectionMask);
    if (!clipboard) return;
    const board = boards.find((entry) => entry.id === activeBoardId)!;
    if (board.layers.length >= MAX_PROJECT_LAYERS) {
      notify(`На холсте может быть не больше ${MAX_PROJECT_LAYERS} слоёв.`, 'error');
      return;
    }
    const totalPixels = getTotalLayerPixels();
    if (totalPixels + buffer.width * buffer.height > MAX_PROJECT_TOTAL_PIXELS) {
      notify('Превышен лимит общего объёма пиксельных данных проекта.', 'error');
      return;
    }
    const pixels = new Uint8ClampedArray(buffer.width * buffer.height * 4);
    const bounds = selectionBounds(selectionMask);
    if (!bounds) return;
    for (let y = 0; y < clipboard.height; y++) {
      for (let x = 0; x < clipboard.width; x++) {
        const source = (y * clipboard.width + x) * 4;
        const target = ((bounds.y + y) * buffer.width + bounds.x + x) * 4;
        if (clipboard.mask[y * clipboard.width + x]) pixels.set(clipboard.pixels.subarray(source, source + 4), target);
      }
    }
    const id = `${activeBoardId}-layer-${Date.now().toString(36)}-${layerSequence++}`;
    const created = createRasterLayer(id, `Выделение ${board.layers.length + 1}`, buffer.width, buffer.height, pixels);
    histories.set(getHistoryKey(activeBoardId, created), new History());
    commitLayerStack(activeBoardId, [...board.layers, created], id);
  }

  function setSelection(next: SelectionMask | null): void {
    if (next && (next.width !== buffer.width || next.height !== buffer.height)) {
      throw new RangeError('Размер выделения должен совпадать с размером холста.');
    }
    selectionPreview = null;
    selectionMask = next;
    buffer.setClipMask(next?.data ?? null);
    canvasApi?.requestRender();
  }

  function editSelectedPixels(edit: () => void): void {
    if (buffer.isLocked) {
      notify('Активный слой заблокирован.', 'error');
      return;
    }
    const beforeSelection = selectionMask;
    const historyKey = getHistoryKey(activeBoardId, getActiveLayer());
    const previousClip = buffer.getClipMask();
    history.begin(buffer);
    buffer.setClipMask(null);
    try {
      edit();
      buffer.setClipMask(selectionMask?.data ?? null);
      if (history.commit(buffer)) {
        pushUndoEntry({
          kind: 'selection-pixels',
          boardId: activeBoardId,
          historyKey,
          beforeSelection,
          afterSelection: selectionMask,
        });
        scheduleAutosave();
      } else {
        syncHistory();
      }
      refreshComposite(activeBoardId, getActiveLayer());
      canvasApi?.requestRender();
    } catch (error) {
      buffer.setClipMask(previousClip);
      history.rollback(buffer);
      throw error;
    }
  }

  function transformSelection(transform: (clipboard: PixelClipboard) => PixelClipboard): void {
    if (!selectionMask) return;
    const bounds = selectionBounds(selectionMask);
    const clipboard = copySelection(buffer, selectionMask);
    if (!bounds || !clipboard) return;
    const transformed = transform(clipboard);
    const x = Math.round(bounds.x + (bounds.width - transformed.width) / 2);
    const y = Math.round(bounds.y + (bounds.height - transformed.height) / 2);
    const preview = new PixelBuffer(buffer.width, buffer.height, buffer.data.slice());
    clearSelection(preview, selectionMask);
    const previewSelection = pasteClipboard(preview, transformed, x, y);
    preview.markAllDirty();
    selectionPreview = { clipboard: transformed, x, y, selection: previewSelection, preview };
    canvasApi?.requestRender();
  }

  function confirmSelectionTransform(): void {
    const pending = selectionPreview;
    if (!pending || !selectionMask) return;
    editSelectedPixels(() => {
      clearSelection(buffer, selectionMask!);
      setSelection(pasteClipboard(buffer, pending.clipboard, pending.x, pending.y));
    });
    selectionPreview = null;
  }

  function cancelSelectionTransform(): void {
    selectionPreview = null;
    canvasApi?.requestRender();
  }

  function runSelectionAction(action: SelectionAction): void {
    if (selectionPreview) cancelSelectionTransform();
    try {
      switch (action) {
        case 'select-all':
          setSelection(createRectSelection(buffer.width, buffer.height, 0, 0, buffer.width - 1, buffer.height - 1));
          return;
        case 'select-opaque':
          setSelection(createOpaqueSelection(drawingSettings.sampleMerged ? activeBoard.buffer : buffer));
          return;
        case 'invert':
          if (selectionMask) setSelection(invertSelection(selectionMask));
          return;
        case 'deselect':
          setSelection(null);
          return;
        case 'copy':
          selectionClipboard = selectionMask
            ? copySelection(drawingSettings.sampleMerged ? activeBoard.buffer : buffer, selectionMask)
            : null;
          if (!selectionClipboard) notify('В выделении нет пикселей для копирования.');
          return;
        case 'cut':
          if (!selectionMask) return;
          selectionClipboard = copySelection(buffer, selectionMask);
          if (selectionClipboard) editSelectedPixels(() => clearSelection(buffer, selectionMask!));
          return;
        case 'paste':
          if (!selectionClipboard) return;
          editSelectedPixels(() => {
            const x = Math.floor((buffer.width - selectionClipboard!.width) / 2);
            const y = Math.floor((buffer.height - selectionClipboard!.height) / 2);
            setSelection(pasteClipboard(buffer, selectionClipboard!, x, y));
          });
          return;
        case 'clear':
          if (selectionMask) editSelectedPixels(() => clearSelection(buffer, selectionMask!));
          return;
        case 'crop': {
          if (!selectionMask) return;
          const bounds = selectionBounds(selectionMask);
          if (!bounds) {
            notify('Нельзя обрезать холст: выделение пустое.', 'error');
            return;
          }
          const currentBoard = boards.find((board) => board.id === activeBoardId)!;
          const beforeLayers = currentBoard.layers;
          const cropLayerBuffer = (source: PixelBuffer): PixelBuffer => {
            const cropped = new PixelBuffer(bounds.width, bounds.height);
            for (let y = 0; y < bounds.height; y++) {
              const sourceStart = ((bounds.y + y) * source.width + bounds.x) * 4;
              const targetStart = y * bounds.width * 4;
              cropped.data.set(source.data.subarray(sourceStart, sourceStart + bounds.width * 4), targetStart);
            }
            cropped.markAllDirty();
            return cropped;
          };
          const afterLayers = currentBoard.layers.map((layer) =>
            ({ ...layer, buffer: cropLayerBuffer(layer.buffer) }),
          );
          const previousSelection = selectionMask;
          selectionMask = null;
          selectionPreview = null;
          replaceLayerStack(activeBoardId, afterLayers, activeLayerId);
          pushUndoEntry({
            kind: 'layer-stack',
            boardId: activeBoardId,
            beforeLayers,
            afterLayers,
            beforeGroups: currentBoard.groups,
            afterGroups: currentBoard.groups,
            beforeActiveLayerId: activeLayerId,
            afterActiveLayerId: activeLayerId,
            beforeSelection: previousSelection,
            afterSelection: null,
          });
          cursor = null;
          scheduleAutosave();
          canvasApi?.requestRender();
          return;
        }
        case 'move-left':
        case 'move-right':
        case 'move-up':
        case 'move-down': {
          if (!selectionMask) return;
          const dx = action === 'move-left' ? -1 : action === 'move-right' ? 1 : 0;
          const dy = action === 'move-up' ? -1 : action === 'move-down' ? 1 : 0;
          editSelectedPixels(() => setSelection(moveSelection(buffer, selectionMask!, dx, dy)));
          return;
        }
        case 'flip-horizontal':
          transformSelection((clipboard) => flipClipboard(clipboard, true));
          return;
        case 'flip-vertical':
          transformSelection((clipboard) => flipClipboard(clipboard, false));
          return;
        case 'rotate-left':
          transformSelection((clipboard) => rotateClipboard(clipboard, -90));
          return;
        case 'rotate-right':
          transformSelection((clipboard) => rotateClipboard(clipboard, 90));
          return;
        case 'scale-up':
          transformSelection((clipboard) => integerScaleClipboard(clipboard, 2));
          return;
        case 'scale-down':
          transformSelection((clipboard) => scaleClipboard(
            clipboard,
            Math.max(1, Math.floor(clipboard.width / 2)),
            Math.max(1, Math.floor(clipboard.height / 2)),
          ));
      }
    } catch (error) {
      notify(`Не удалось выполнить операцию выделения: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  function setBrushSize(size: number): void {
    brushSize = clampBrushSize(size);
    selectedBrushId = '';
  }

  function setBrushOpacity(opacity: number): void {
    if (!Number.isFinite(opacity)) return;
    brushOpacity = Math.min(100, Math.max(0, Math.round(opacity)));
  }

  /** Все изменения цвета идут через эту функцию, поэтому правило палитры нельзя обойти. */
  function setColor(slot: ColorSlot, color: RGBA): void {
    const next = constrainColor(palette, color, freeColor);
    if (slot === 'primary') primary = next;
    else secondary = next;
  }

  async function importReference(file: File): Promise<void> {
    const extension = file.name.split('.').at(-1)?.toLowerCase();
    if (!extension || !['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(extension)) {
      notify('Поддерживаются изображения PNG, JPEG, WebP и BMP.', 'error');
      return;
    }
    if (references.length >= MAX_PROJECT_REFERENCES) {
      notify(`Можно добавить не больше ${MAX_PROJECT_REFERENCES} референсов.`, 'error');
      return;
    }

    try {
      const image = await decodeRasterImage(file);
      const totalPixels = references.reduce((sum, reference) => sum + reference.width * reference.height, 0);
      if (totalPixels + image.width * image.height > MAX_REFERENCE_TOTAL_PIXELS) {
        notify('Общая площадь изображений референсов превышает допустимый лимит.', 'error');
        return;
      }

      const board = boards.find((entry) => entry.id === activeBoardId)!;
      const scale = Math.max(MIN_REFERENCE_SCALE, Math.min(1, 256 / image.width, 256 / image.height));
      const id = `reference-${Date.now().toString(36)}-${references.length + 1}`;
      const reference: ReferenceImage = {
        id,
        name: file.name.slice(0, 255) || 'Референс',
        width: image.width,
        height: image.height,
        pixels: image.pixels,
        x: Math.round(board.x + (board.buffer.width - image.width * scale) / 2),
        y: Math.round(board.y + (board.buffer.height - image.height * scale) / 2),
        scale,
        rotation: 0,
        opacity: 0.6,
        visible: true,
        locked: false,
      };
      const before = references.map((entry) => ({ ...entry }));
      references = [...references, reference];
      selectedReferenceId = id;
      referencesOpen = true;
      recordReferenceChange(before);
      notify('Референс импортирован.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось импортировать референс.', 'error');
    }
  }

  function updateReference(
    id: string,
    update: Partial<Pick<ReferenceImage, 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'visible' | 'locked'>>,
    recordHistory = true,
  ): void {
    const before = recordHistory ? references.map((reference) => ({ ...reference })) : null;
    let changed = false;
    references = references.map((reference) => {
      if (reference.id !== id) return reference;
      const next = { ...reference, ...update };
      next.x = Number.isFinite(next.x) ? Math.max(-1_000_000, Math.min(1_000_000, Math.round(next.x))) : reference.x;
      next.y = Number.isFinite(next.y) ? Math.max(-1_000_000, Math.min(1_000_000, Math.round(next.y))) : reference.y;
      next.scale = Number.isFinite(next.scale)
        ? Math.min(MAX_REFERENCE_SCALE, Math.max(MIN_REFERENCE_SCALE, next.scale))
        : reference.scale;
      next.rotation = Number.isFinite(next.rotation) ? Math.max(-360, Math.min(360, next.rotation)) : reference.rotation;
      next.opacity = Number.isFinite(next.opacity) ? Math.max(0, Math.min(1, next.opacity)) : reference.opacity;
      changed = true;
      return next;
    });
    if (changed) {
      if (before) recordReferenceChange(before);
      else scheduleAutosave();
    }
  }

  function removeReference(id: string): void {
    const before = references.map((reference) => ({ ...reference }));
    references = references.filter((reference) => reference.id !== id);
    if (selectedReferenceId === id) selectedReferenceId = references[0]?.id ?? null;
    recordReferenceChange(before);
  }

  function recordReferenceChange(before: ReferenceImage[]): void {
    const unchanged = before.length === references.length && before.every((reference, index) => {
      const current = references[index]!;
      return (
        reference.id === current.id &&
        reference.name === current.name &&
        reference.pixels === current.pixels &&
        reference.x === current.x &&
        reference.y === current.y &&
        reference.scale === current.scale &&
        reference.rotation === current.rotation &&
        reference.opacity === current.opacity &&
        reference.visible === current.visible &&
        reference.locked === current.locked
      );
    });
    if (!unchanged) pushUndoEntry({
      kind: 'references',
      before,
      after: references.map((reference) => ({ ...reference })),
    });
    scheduleAutosave();
  }

  function beginReferenceMove(): void {
    referenceMoveSnapshot = references.map((reference) => ({ ...reference }));
  }

  function endReferenceMove(): void {
    const before = referenceMoveSnapshot;
    referenceMoveSnapshot = null;
    if (before) recordReferenceChange(before);
  }

  function cancelReferenceMove(): void {
    if (!referenceMoveSnapshot) return;
    references = referenceMoveSnapshot;
    referenceMoveSnapshot = null;
    scheduleAutosave();
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
    const { width, height } = activeBoard.buffer;
    const exportLayers = activeBoard.layers.filter((layer) => layer.role !== 'reference');
    const baseExportBuffer = exportLayers.length
      ? compositeLayers(width, height, exportLayers, undefined, undefined, activeBoard.groups)
      : new PixelBuffer(width, height);
    const exportBuffer = includeReferencesInExport
      ? applyReferencesToBuffer(baseExportBuffer, activeBoard.x, activeBoard.y, references)
      : baseExportBuffer;
    const extension = exportFormat === 'jpeg' ? 'jpg' : exportFormat;
    const filename = `pixel-art-${width}x${height}@${exportScale}x.${extension}`;
    const mimeType = exportFormat === 'jpeg' ? 'image/jpeg' : `image/${exportFormat}`;
    const destination = await chooseSaveDestination(filename, mimeType, [`.${extension}`]);
    if (!destination) return;

    try {
      const blob =
        exportFormat === 'png'
          ? await exportPngBlob(exportBuffer, exportScale)
          : await exportRasterBlob(exportBuffer, exportScale, exportFormat, canvasBackground);
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
    buffer.setClipMask(null);
    selectionMask = null;
    selectionPreview = null;
    boards = project.canvases
      ? project.canvases.map((canvas) => makeArtboard(
          canvas.id, canvas.x, canvas.y, canvas.width, canvas.height, canvas.pixels, canvas.layers, canvas.activeLayerId,
        ))
      : [makeArtboard(
          project.activeCanvasId ?? 'canvas-1', 0, 0, project.width, project.height, project.pixels,
        )];
    activeBoardId = project.activeCanvasId ?? boards[0]!.id;
    const activeBoard = boards.find((board) => board.id === activeBoardId)!;
    activeLayerId = activeBoard.activeLayerId;
    buffer = activeBoard.layers.find((layer) => layer.id === activeLayerId)!.buffer;
    buffer.setClipMask(null);
    histories.clear();
    for (const board of boards) {
      for (const layer of board.layers) histories.set(getHistoryKey(board.id, layer), new History());
    }
    undoTimeline.length = 0;
    redoTimeline.length = 0;
    history = histories.get(getHistoryKey(activeBoardId, activeBoard.layers.find((layer) => layer.id === activeLayerId)!))!;
    paletteId = project.paletteId;
    freeColor = project.freeColor;
    primary = project.primary;
    secondary = project.secondary;
    recent = project.recent;
    references = project.references?.map((reference) => ({ ...reference })) ?? [];
    selectedReferenceId = references[0]?.id ?? null;
    syncHistory();
    cursor = null;
    scheduleAutosave();
  }

  // ——— Подтверждения ———

  function requestResize(width: number, height: number): void {
    if (!isValidCanvasSize(width, height)) return;
    if (width === buffer.width && height === buffer.height) return;
    const activeBoard = boards.find((board) => board.id === activeBoardId)!;
    const currentArea = activeBoard.layers.reduce((sum, layer) => sum + layer.buffer.width * layer.buffer.height, 0);
    const totalPixels = getTotalLayerPixels();
    if (totalPixels - currentArea + width * height * activeBoard.layers.length > MAX_PROJECT_TOTAL_PIXELS) {
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
      if (history.commit(buffer)) pushUndoEntry({
        kind: 'pixels',
        boardId: activeBoardId,
        historyKey: getHistoryKey(activeBoardId, getActiveLayer()),
      });
      else syncHistory();
      refreshComposite(activeBoardId, getActiveLayer());
      canvasApi?.requestRender();
      scheduleAutosave();
      notify('Холст очищен. Действие можно отменить сочетанием Ctrl+Z.');
    } else if (action.kind === 'resize') {
      const currentBoard = boards.find((board) => board.id === activeBoardId)!;
      const beforeLayers = currentBoard.layers;
      const afterLayers = currentBoard.layers.map((layer) =>
        ({ ...layer, buffer: layer.buffer.resized(action.width, action.height) }),
      );
      selectionMask = null;
      selectionPreview = null;
      replaceLayerStack(activeBoardId, afterLayers, activeLayerId);
      pushUndoEntry({
        kind: 'layer-stack',
        boardId: activeBoardId,
        beforeLayers,
        afterLayers,
        beforeGroups: currentBoard.groups,
        afterGroups: currentBoard.groups,
        beforeActiveLayerId: activeLayerId,
        afterActiveLayerId: activeLayerId,
      });
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

    if (e.altKey) {
      temporaryPicker = true;
      return;
    }

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
      } else if (e.code === 'KeyC') {
        e.preventDefault();
        runSelectionAction('copy');
      } else if (e.code === 'KeyX') {
        e.preventDefault();
        runSelectionAction('cut');
      } else if (e.code === 'KeyV') {
        e.preventDefault();
        runSelectionAction('paste');
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
    if (!e.altKey) temporaryPicker = false;
    if (e.code !== 'Space') return;
    spaceHeld = false;
    if (!pending && !helpOpen && !settingsOpen && !isTypingTarget(e.target)) e.preventDefault();
  }

  function onWindowBlur(): void {
    spaceHeld = false;
    temporaryPicker = false;
  }

  if (storage) {
    try {
      const savedBrushes = storage.getItem(BRUSH_LIBRARY_KEY);
      if (savedBrushes) brushLibrary = parseBrushLibrary(savedBrushes);
    } catch (error) {
      brushLibraryError = `Библиотека кистей повреждена и не загружена: ${error instanceof Error ? error.message : String(error)}`;
    }
  } else {
    brushLibraryError = 'Библиотека кистей недоступна: браузер не разрешил доступ к локальному хранилищу.';
  }

  if (preferences.error) notify(preferences.error, 'error');
  if (brushLibraryError) notify(brushLibraryError, 'error');
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
    {gridMode}
    {gridSpacing}
    {snapToGrid}
    {checkerboard}
    {tiledMode}
    {symmetryX}
    {symmetryY}
    {customSizes}
    ontogglegrid={toggleGrid}
    ongridmode={setGridMode}
    ongridspacing={setGridSpacing}
    onsnaptogrid={setSnapToGrid}
    oncheckerboard={setCheckerboard}
    ontiledmode={(enabled) => (tiledMode = enabled)}
    onsymmetryx={(enabled) => (symmetryX = enabled)}
    onsymmetryy={(enabled) => (symmetryY = enabled)}
    {referencesOpen}
    {includeReferencesInExport}
    hasVisibleReferences={references.some((reference) => reference.visible)}
    ontogglereferences={() => (referencesOpen = !referencesOpen)}
    onincludeReferencesInExport={(include) => (includeReferencesInExport = include)}
    onpreview={openPreviewWindow}
    onfit={fitCanvas}
    oncenter={() => canvasApi?.centerActiveBoard()}
    onactualsize={() => canvasApi?.actualSize()}
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
      {brushShape}
      {brushOpacity}
      settings={drawingSettings}
      brushes={brushLibrary}
      {selectedBrushId}
      {selectionMode}
      {selectionOperation}
      selectionAvailable={selectionMask !== null}
      clipboardAvailable={selectionClipboard !== null}
      layers={activeLayers}
      groups={activeBoard.groups}
      {activeLayerId}
      hasSelection={selectionMask !== null}
      onselect={selectTool}
      onbrush={setBrushSize}
      onbrushshape={setBrushShape}
      onbrushopacity={setBrushOpacity}
      onsettings={updateDrawingSettings}
      onbrushsave={saveBrush}
      onbrushselect={selectBrush}
      onbrushdelete={removeBrush}
      onbrushupdate={updateBrush}
      onbrushimport={importBrushLibrary}
      onbrusherror={(message) => notify(message, 'error')}
      onbrushexport={(brush) => serializeBrushLibrary([brush])}
      onaddboard={addBoard}
      onselectionmode={(mode) => (selectionMode = mode)}
      onselectionoperation={(operation) => (selectionOperation = operation)}
      onselectionaction={runSelectionAction}
      onlayerselect={selectLayer}
      onlayeradd={addLayer}
      onaddgroup={addLayerGroup}
      ongroupupdate={updateGroup}
      ongroupdelete={deleteGroup}
      onlayerduplicate={duplicateLayer}
      onlayerdelete={deleteLayer}
      onlayermove={moveLayer}
      onlayerreorder={reorderLayers}
      onlayerupdate={updateLayer}
      onaddbackground={() => addSpecialLayer('background')}
      onaddreference={() => addSpecialLayer('reference')}
      oncreatefromselection={getLayersFromSelection}
    />

    <section class="workspace" aria-label="Холст">
      <Canvas
        bind:this={canvasApi}
        {buffer}
        bind:view
        bind:cursor
        {showGrid}
        {gridMode}
        {gridSpacing}
        {snapToGrid}
        {checkerboard}
        {tiledMode}
        {symmetryX}
        {symmetryY}
        {guides}
        {boards}
        {references}
        {selectedReferenceId}
        {activeBoardId}
        {canvasBackground}
        {workspaceBackground}
        panMode={spaceHeld}
        tool={activeTool}
        {primary}
        {secondary}
        {brushSize}
        {brushShape}
        {brushOpacity}
        brushDefinition={brushLibrary.find((entry) => entry.id === selectedBrushId) ?? null}
        settings={drawingSettings}
        {temporaryPicker}
        {selectionMask}
        previewSelection={selectionPreview?.selection ?? null}
        {selectionMode}
        {selectionOperation}
        previewBuffer={selectionPreview?.preview ?? null}
        onpickcolor={setColor}
        onusecolor={rememberColor}
        onstrokebegin={beginStroke}
        onstrokeend={endStroke}
        onrender={() => refreshComposite(activeBoardId, getActiveLayer())}
        onselectboard={selectBoard}
        onmoveboard={moveBoard}
        onmoveboards={moveBoards}
        onselectreference={(id) => (selectedReferenceId = id)}
        onreferencemovestart={beginReferenceMove}
        onreferencemove={(id, x, y) => updateReference(id, { x, y }, false)}
        onreferencemoveend={endReferenceMove}
        onreferencemovecancel={cancelReferenceMove}
        onselection={setSelection}
        onguideschange={updateGuides}
        onpreviewerror={(message) => notify(message, 'error')}
        onconfirmtransform={confirmSelectionTransform}
        oncanceltransform={cancelSelectionTransform}
      />
      {#if referencesOpen}
        <ReferencesPanel
          {references}
          {selectedReferenceId}
          onimport={(file) => void importReference(file)}
          onselect={(id) => (selectedReferenceId = id)}
          onupdate={updateReference}
          onremove={removeReference}
          onclose={() => (referencesOpen = false)}
        />
      {/if}
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
