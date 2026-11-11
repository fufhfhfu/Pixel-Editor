<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import Canvas, { type ViewportGuide } from './components/Canvas.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import HelpDialog from './components/HelpDialog.svelte';
  import FeedbackNotesDialog from './components/FeedbackNotesDialog.svelte';
  import NotesDialog from './components/NotesDialog.svelte';
  import WelcomeDialog from './components/WelcomeDialog.svelte';
  import SettingsDialog from './components/SettingsDialog.svelte';
  import ReferencesPanel from './components/ReferencesPanel.svelte';
  import TilemapEditor from './components/TilemapEditor.svelte';
  import PalettePanel from './components/PalettePanel.svelte';
  import ProjectMetadataPanel from './components/ProjectMetadataPanel.svelte';
  import ProjectBar from './components/ProjectBar.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import Toast from './components/Toast.svelte';
  import ToolPanel from './components/ToolPanel.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import DockSplitter from './components/DockSplitter.svelte';
  import WorkspaceControls from './components/WorkspaceControls.svelte';
  import TimelinePanel from './components/TimelinePanel.svelte';
  import EditorMenuBar, { type EditorMenuGroup } from './components/EditorMenuBar.svelte';
  import LayersPanel from './components/LayersPanel.svelte';
  import {
    DEFAULT_EXPORT_SCALE,
    exportPngBlob,
    exportRasterBlob,
    getAvailableExportScales,
    isExportScale,
    isExportFormat,
    EXPORT_FORMATS,
    EXPORT_SCALES,
    type ExportFormat,
    type ExportScale,
  } from './core/export';
  import {
    decodeRasterImage,
    MAX_IMAGE_FILE_BYTES,
    type DecodedRasterImage,
  } from './core/imageImport';
  import { MAX_NOTES_IMPORT_BYTES, parseNotesImport } from './core/notesImport';
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
    advanceAnimation,
    createAnimationFrame,
    duplicateAnimationFrame,
    insertAnimationFrame,
    removeAnimationFrame,
    updateFrameDuration,
    type AnimationFrame,
  } from './core/animation';
  import {
    DEFAULT_PALETTE_ID,
    PALETTES,
    MAX_CUSTOM_PALETTES,
    constrainColor,
    filterToPalette,
    getPalette,
    nearestPaletteColor,
    parseCustomPalettes,
    pushRecentColor,
    type ColorSlot,
    type Palette,
  } from './core/palette';
  import {
    MAX_PROJECT_JSON_LENGTH,
    MAX_PROJECT_CANVASES,
    MAX_PROJECT_CANVAS_COORDINATE,
    MAX_PROJECT_LAYERS,
    MAX_PROJECT_TOTAL_PIXELS,
    MAX_PROJECT_ANIMATION_PIXELS,
    ProjectFormatError,
    parseProject,
    serializeProject,
    type ProjectData,
    type ProjectMetadata,
  } from './core/project';
  import {
    loadEditorPreferences,
    saveCanvasBackground,
    saveWorkspaceBackground,
    saveGridMode,
    saveGridSpacing,
    saveSnapToGrid,
    saveCheckerboard,
    saveSecondaryColorDrawing,
    saveCustomSizes,
    saveThemePreference,
    currentSizeIsBuiltIn,
    GRID_SPACINGS,
    MAX_CUSTOM_SIZES,
    type CanvasSize,
    type GridMode,
    type ThemePreference,
  } from './core/preferences';
  import {
    findShortcutConflicts,
    formatShortcutSequence,
    getTemporaryActionForCode,
    loadShortcutMap,
    resolveShortcutEvent,
    saveShortcutMap,
    type ShortcutMap,
    type ShortcutSequence,
  } from './core/hotkeys';
  import {
    AutosaveRepository,
    type AutosaveStorageMode,
  } from './core/autosave';
  import { saveDesktopBlob } from './core/desktopFiles';
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
  import { getAppStorage, type SaveStatus } from './core/storage';
  import { WELCOME_SEEN_KEY } from './core/feedbackNotes';
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
  import { floodFillAsync } from './core/tools/floodFill';
  import type { PixelPos, ViewState } from './core/viewport';
  import type { TilemapData } from './core/tilemap';
  import {
    getWorkspacePreset,
    loadWorkspaceLayout,
    resizeWorkspaceDock,
    saveWorkspaceLayout,
    type DockId,
    type WorkspaceId,
    type WorkspacePanelId,
    type WorkspaceLayout,
  } from './core/workspace';
  type SelectionAction =
    | 'select-all' | 'select-opaque' | 'invert' | 'deselect' | 'copy' | 'cut' | 'paste' | 'clear' | 'crop'
    | 'move-left' | 'move-right' | 'move-up' | 'move-down'
    | 'flip-horizontal' | 'flip-vertical' | 'rotate-left' | 'rotate-right' | 'scale-up' | 'scale-down';

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
      notify('Библиотека кистей недоступна: нет доступа к хранилищу приложения.', 'error');
      return;
    }
    try {
      storage.setItem(BRUSH_LIBRARY_KEY, serializeBrushLibrary(brushLibrary));
    } catch (error) {
      notify(`Не удалось сохранить библиотеку кистей: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  function mergeBrushDefinitions(
    existing: readonly BrushDefinition[],
    incoming: readonly BrushDefinition[],
  ): BrushDefinition[] {
    const merged = [...existing];
    for (const brush of incoming) {
      const byId = merged.findIndex((entry) => entry.id === brush.id);
      const byName = merged.findIndex((entry) => entry.name.toLowerCase() === brush.name.toLowerCase());
      const index = byId >= 0 ? byId : byName;
      if (index >= 0) merged[index] = brush;
      else if (merged.length < 64) merged.push(brush);
    }
    return merged;
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
    if (activeToolId === 'eraser') eraserSize = brush.size;
    else pencilSize = brush.size;
    brushShape = brush.type === 'circle' ? 'circle' : 'square';
  }

  function removeBrush(): void {
    if (!selectedBrushId) return;
    brushLibrary = brushLibrary.filter((brush) => brush.id !== selectedBrushId);
    selectedBrushId = '';
    persistBrushLibrary();
  }

  function importBrushLibrary(incoming: readonly BrushDefinition[]): void {
    brushLibrary = mergeBrushDefinitions(brushLibrary, incoming);
    persistBrushLibrary();
    notify(`Импортировано кистей: ${incoming.length}.`);
  }

  let { initialProject, initialLoadError, initialStorageMode, autosaveRepository }: Props = $props();

  /** Действие, которое ждёт подтверждения в диалоге. */
  type PendingAction =
    | { kind: 'resize'; width: number; height: number }
    | { kind: 'import'; project: ProjectData; fileName: string }
    | { kind: 'image'; image: DecodedRasterImage; fileName: string; boardId: string }
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
        kind: 'remove';
        board: Artboard;
        index: number;
        previousActiveBoardId: string;
        fallbackActiveBoardId: string;
      }
    | {
        kind: 'move';
        before: Array<{ id: string; x: number; y: number }>;
        after: Array<{ id: string; x: number; y: number }>;
      };
  type UndoEntry =
    | { kind: 'pixels'; boardId: string; historyKey: string }
    | {
        kind: 'tilemap';
        before: TilemapData | null;
        after: TilemapData;
        groupId: string | null;
      }
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
        beforeAnimationFrames?: AnimationFrame[];
        afterAnimationFrames?: AnimationFrame[];
        beforeAnimationFramesByLayer?: Map<string, AnimationFrame[]>;
        afterAnimationFramesByLayer?: Map<string, AnimationFrame[]>;
        beforeActiveFrameIndex?: number;
        afterActiveFrameIndex?: number;
      }
    | { kind: 'references'; before: ReferenceImage[]; after: ReferenceImage[] }
    | { kind: 'board'; action: BoardAction };

  /** Пауза после последнего изменения перед сохранением проекта в локальное хранилище. */
  const AUTOSAVE_DELAY_MS = 800;
  const NOTICE_DURATION_MS = 5000;

  // Стартовые цвета подбираются по ближайшему цвету палитры по умолчанию
  const START_PRIMARY: RGBA = { r: 255, g: 0, b: 77, a: 255 };
  const START_SECONDARY: RGBA = { r: 255, g: 241, b: 232, a: 255 };

  const storage = getAppStorage();
  function shouldShowWelcome(): boolean {
    try {
      return storage?.getItem(WELCOME_SEEN_KEY) !== 'true';
    } catch {
      return true;
    }
  }
  const preferences = loadEditorPreferences(storage);
  const savedShortcuts = loadShortcutMap(storage);
  const savedWorkspace = loadWorkspaceLayout(storage);
  const start = untrack(() => initialProject);
  const startupStorageMode = untrack(() => initialStorageMode);
  const startPalette = PALETTES.find((entry) => entry.id === start?.paletteId) ??
    start?.customPalettes?.find((entry) => entry.id === start?.paletteId) ??
    getPalette(DEFAULT_PALETTE_ID);
  const animationFramesByLayer = new Map<string, AnimationFrame[]>();

  function getAnimationLayerKey(boardId: string, layerId: string): string {
    return `${boardId}:${layerId}`;
  }

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

  let initialBoards: Artboard[] = start?.canvases
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
  const initialActiveBoardId = start?.activeCanvasId ?? initialBoards[0]!.id;
  const initialActiveBoardBeforeAnimation = initialBoards.find((board) => board.id === initialActiveBoardId)!;
  const initialActiveLayerBeforeAnimation = initialActiveBoardBeforeAnimation.layers
    .find((layer) => layer.id === initialActiveBoardBeforeAnimation.activeLayerId)!;
  for (const canvas of start?.canvases ?? []) {
    for (const sourceLayer of canvas.layers ?? []) {
      if (!sourceLayer.animationFrames) continue;
      animationFramesByLayer.set(
        getAnimationLayerKey(canvas.id, sourceLayer.id),
        sourceLayer.animationFrames.map((frame) =>
          createAnimationFrame(frame.id, canvas.width, canvas.height, frame.pixels, frame.durationMs)),
      );
    }
  }
  const initialAnimationLayerKey = getAnimationLayerKey(
    initialActiveBoardId,
    initialActiveLayerBeforeAnimation.id,
  );
  let initialAnimationFrames = animationFramesByLayer.get(initialAnimationLayerKey) ??
    start?.animationFrames?.map((frame) =>
      createAnimationFrame(frame.id, start.width, start.height, frame.pixels, frame.durationMs),
    ) ?? [];
  if (initialAnimationFrames.length === 0) {
    initialAnimationFrames = [{
      id: 'frame-1',
      durationMs: 100,
      buffer: initialActiveLayerBeforeAnimation.buffer,
    }];
  }
  animationFramesByLayer.set(initialAnimationLayerKey, initialAnimationFrames);
  const firstAnimationBuffer = initialAnimationFrames[0]!.buffer;
  initialBoards = initialBoards.map((board) => {
    if (board.id !== initialActiveBoardId) return board;
    const layers = board.layers.map((layer) => layer.id === board.activeLayerId
      ? { ...layer, buffer: firstAnimationBuffer }
      : layer);
    firstAnimationBuffer.setLocked(initialActiveLayerBeforeAnimation.locked);
    firstAnimationBuffer.setAlphaLock(initialActiveLayerBeforeAnimation.alphaLock);
    const groupBuffers = new Map<string, PixelBuffer>();
    const composite = compositeLayers(
      firstAnimationBuffer.width,
      firstAnimationBuffer.height,
      layers,
      undefined,
      undefined,
      board.groups,
      groupBuffers,
    );
    for (const layer of layers) layer.buffer.takeDirty();
    return { ...board, layers, groupBuffers, buffer: composite };
  });
  const initialActiveBoard = initialBoards.find((board) => board.id === initialActiveBoardId)!;
  const initialActiveLayer = initialActiveBoard.layers.find((layer) => layer.id === initialActiveBoard.activeLayerId)!;
  const bufferHistoryIds = new WeakMap<PixelBuffer, number>();
  const frameByHistoryKey = new Map<string, string>();
  const frameBufferIds = new WeakMap<PixelBuffer, string>();
  for (const frames of animationFramesByLayer.values()) {
    for (const frame of frames) frameBufferIds.set(frame.buffer, frame.id);
  }
  for (const frame of initialAnimationFrames) frameBufferIds.set(frame.buffer, frame.id);
  let nextBufferHistoryId = 1;
  function getHistoryKey(boardId: string, layer: RasterLayer): string {
    let historyId = bufferHistoryIds.get(layer.buffer);
    if (!historyId) {
      historyId = nextBufferHistoryId++;
      bufferHistoryIds.set(layer.buffer, historyId);
    }
    const key = `${boardId}:${historyId}`;
    const frameId = frameBufferIds.get(layer.buffer);
    if (frameId) frameByHistoryKey.set(key, frameId);
    return key;
  }
  const histories = new Map(initialBoards.flatMap((board) =>
    board.layers.map((layer) => [getHistoryKey(board.id, layer), new History()] as const),
  ));
  const undoTimeline: UndoEntry[] = [];
  const redoTimeline: UndoEntry[] = [];
  let historyRevision = $state(0);
  const MAX_TILEMAP_HISTORY_ENTRIES = 100;
  const MAX_TILEMAP_HISTORY_BYTES = 64 * 1024 * 1024;
  let history = histories.get(getHistoryKey(initialActiveBoardId, initialActiveLayer))!;
  let boards = $state.raw<Artboard[]>(initialBoards);
  let activeBoardId = $state(initialActiveBoardId);
  let activeLayerId = $state(initialActiveBoard.activeLayerId);
  let buffer = $state.raw(initialActiveBoard.layers.find((layer) => layer.id === activeLayerId)!.buffer);
  let animationFrames = $state.raw<AnimationFrame[]>(initialAnimationFrames);
  let activeFrameIndex = $state(0);
  let animationPlaying = $state(false);
  let animationTimer: ReturnType<typeof setInterval> | undefined;
  let animationLastTick = 0;
  let animationElapsed = 0;
  let references = $state.raw<ReferenceImage[]>(start?.references?.map((reference) => ({ ...reference })) ?? []);
  let tilemap = $state.raw<TilemapData | null>(start?.tilemap ?? null);
  let tilemapMode = $state(false);
  let workspaceLayout = $state.raw<WorkspaceLayout>(savedWorkspace.layout);
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
  let secondaryColorDrawing = $state(preferences.secondaryColorDrawing);
  let tiledMode = $state(false);
  let symmetryX = $state(false);
  let symmetryY = $state(false);
  let guides = $state.raw<ViewportGuide[]>([]);
  let canvasBackground = $state(preferences.canvasBackground);
  let workspaceBackground = $state(preferences.workspaceBackground);
  let customSizes = $state.raw<CanvasSize[]>(preferences.customSizes);
  let spaceHeld = $state(false);
  let pending = $state.raw<PendingAction | null>(null);
  let welcomeOpen = $state(shouldShowWelcome());
  let welcomeTrigger = $state<HTMLElement | null>(null);
  let feedbackNotesOpen = $state(false);
  let feedbackNotesTrigger = $state<HTMLElement | null>(null);
  let projectNotesOpen = $state(false);
  let projectNotesTrigger = $state<HTMLElement | null>(null);
  let notesText = $state(start?.notes ?? '');
  let notesTitle = $state('Заметки проекта');
  let notesCreatedAt = $state(Date.now());
  let notesUpdatedAt = $state(Date.now());
  let notesStatus = $state('сохранено в проекте');
  let helpOpen = $state(false);
  let helpTrigger = $state<HTMLElement | null>(null);
  let settingsOpen = $state(false);
  let settingsTab = $state<'general' | 'background' | 'hotkeys'>('general');
  let settingsTrigger = $state<HTMLElement | null>(null);
  let theme = $state<ThemePreference>(preferences.theme);
  let shortcuts = $state.raw<ShortcutMap>(savedShortcuts.shortcuts);
  let pendingShortcutSequence = $state.raw<ShortcutSequence>([]);
  let shortcutSequenceTimer: ReturnType<typeof setTimeout> | undefined;
  let canvasApi = $state.raw<ReturnType<typeof Canvas>>();
  let boardSequence = 1;
  let layerSequence = 1;

  let activeToolId = $state<ToolId>('pencil');
  let fillInProgress = $state(false);
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
  let pencilSize = $state(MIN_BRUSH_SIZE);
  let eraserSize = $state(MIN_BRUSH_SIZE);
  const brushSize = $derived(activeToolId === 'eraser' ? eraserSize : pencilSize);
  let brushShape = $state<BrushShape>('square');
  let brushOpacity = $state(100);
  const BRUSH_LIBRARY_KEY = 'pixel-editor:brush-library';
  let brushLibrary = $state.raw<BrushDefinition[]>(start?.brushes?.map((brush) => ({ ...brush, mask: [...brush.mask] })) ?? []);
  let projectMetadata = $state.raw<ProjectMetadata>(start?.metadata ?? {});
  let brushPanelName = $state('Моя кисть');
  let brushPanelType = $state<BrushType>('pencil');
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
  let customPalettes = $state.raw<Palette[]>(start?.customPalettes ?? []);
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
  let workspaceSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let autosaveFailureReported = false;
  let autosaveArmed = false;
  let autosaveRevision = 0;

  const activeTool = $derived(getTool(activeToolId));
  function shortcutLabel(actionId: string): string {
    return (shortcuts[actionId] ?? []).map(formatShortcutSequence).join('; ') || '—';
  }
  const keyboardTools = $derived(TOOLS.map((tool) => ({
    ...tool,
    hotkeyLabel: shortcutLabel(`tool:${tool.id}`),
  })));
  const activeBoard = $derived(boards.find((board) => board.id === activeBoardId) ?? boards[0]!);
  const activeLayers = $derived(activeBoard.layers);
  const historyEntries = $derived(undoTimeline.slice(-10).reverse().map((entry) => {
    void historyRevision;
    if (entry.kind === 'pixels' || entry.kind === 'selection-pixels') return 'Изменение пикселей';
    if (entry.kind === 'tilemap') return 'Изменение Tilemap';
    if (entry.kind === 'layer-stack') return 'Изменение слоёв';
    if (entry.kind === 'references') return 'Изменение референсов';
    return entry.action.kind === 'add' ? 'Добавление холста' : 'Перемещение холстов';
  }));
  const allPalettes = $derived([...PALETTES, ...customPalettes]);
  const palette = $derived(allPalettes.find((entry) => entry.id === paletteId) ?? getPalette(DEFAULT_PALETTE_ID));
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

  function showWelcome(trigger: HTMLElement | null = null): void {
    welcomeTrigger = trigger?.isConnected
      ? trigger
      : document.querySelector<HTMLElement>('[aria-label="Приветствие"]');
    welcomeOpen = true;
  }

  function showFeedbackNotes(trigger: HTMLElement | null = null): void {
    feedbackNotesTrigger = trigger?.isConnected
      ? trigger
      : document.querySelector<HTMLElement>('[aria-label="Горячие клавиши"]');
    feedbackNotesOpen = true;
  }

  function showProjectNotes(trigger: HTMLElement | null = null): void {
    projectNotesTrigger = trigger?.isConnected ? trigger : null;
    projectNotesOpen = true;
  }

  function updateProjectNotes(value: string): void {
    notesText = value;
    notesUpdatedAt = Date.now();
    notesStatus = 'сохраняется…';
    scheduleAutosave();
  }

  async function importNotesFile(file: File): Promise<void> {
    if (file.size > MAX_NOTES_IMPORT_BYTES) {
      notify('Файл заметок превышает допустимый размер 5 МБ.', 'error');
      return;
    }
    try {
      updateProjectNotes(parseNotesImport(file.name, await file.text()));
      notify('Заметки импортированы в проект.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось импортировать заметки.', 'error');
    }
  }

  async function exportProjectNotes(format: 'markdown' | 'text' | 'json'): Promise<void> {
    const config = format === 'json'
      ? { filename: 'pixel-editor-notes.json', mime: 'application/json' }
      : format === 'text'
        ? { filename: 'pixel-editor-notes.txt', mime: 'text/plain' }
        : { filename: 'pixel-editor-notes.md', mime: 'text/markdown' };
    const content = format === 'json'
      ? JSON.stringify({ format: 'pixel-editor-notes', version: 1, exportedAt: new Date().toISOString(), notes: notesText }, null, 2)
      : format === 'text'
        ? `${notesText.trim()}\n`
        : `# Заметки Pixel Editor\n\n${notesText.trim()}\n`;
    try {
      if (await saveDesktopBlob(new Blob([content], { type: config.mime }), config.filename) === 'saved') {
        notify('Заметки экспортированы.');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось экспортировать заметки.', 'error');
    }
  }

  function acknowledgeWelcome(): void {
    try {
      if (!storage) throw new Error('Локальное хранилище недоступно.');
      storage.setItem(WELCOME_SEEN_KEY, 'true');
      welcomeOpen = false;
    } catch (error) {
      notify(
        `Не удалось сохранить факт ознакомления: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
    }
  }

  function scheduleWorkspaceSave(): void {
    clearTimeout(workspaceSaveTimer);
    workspaceSaveTimer = setTimeout(() => {
      workspaceSaveTimer = undefined;
      if (!saveWorkspaceLayout(storage, workspaceLayout)) {
        notify('Рабочее пространство применено, но сохранить его настройки не удалось.', 'error');
      }
    }, 200);
  }

  function selectWorkspace(id: WorkspaceId): void {
    workspaceLayout = getWorkspacePreset(id);
    tilemapMode = id === 'tileset';
    scheduleWorkspaceSave();
  }

  function selectAnimationFrame(index: number, persist = true): void {
    const frame = animationFrames[index];
    if (!frame || animationFrames[activeFrameIndex]?.id === frame.id) return;
    const board = boards.find((entry) => entry.id === activeBoardId);
    const layer = board?.layers.find((entry) => entry.id === activeLayerId);
    if (!board || !layer || frame.buffer.width !== buffer.width || frame.buffer.height !== buffer.height) {
      notify('Не удалось переключить кадр: размер кадра не совпадает с активным холстом.', 'error');
      return;
    }
    frameBufferIds.set(frame.buffer, frame.id);
    replaceLayerStack(activeBoardId, board.layers.map((entry) =>
      entry.id === activeLayerId ? { ...entry, buffer: frame.buffer } : entry), activeLayerId);
    activeFrameIndex = index;
    cursor = null;
    if (persist) scheduleAutosave();
  }

  function getAnimationFramesForLayer(boardId: string, layer: RasterLayer): AnimationFrame[] {
    const key = getAnimationLayerKey(boardId, layer.id);
    const saved = animationFramesByLayer.get(key);
    if (saved) return saved;
    const frame: AnimationFrame = {
      id: frameBufferIds.get(layer.buffer) ?? `frame-${Date.now().toString(36)}`,
      durationMs: 100,
      buffer: layer.buffer,
    };
    frameBufferIds.set(frame.buffer, frame.id);
    const frames = [frame];
    animationFramesByLayer.set(key, frames);
    return frames;
  }

  function setCurrentAnimationFrames(frames: AnimationFrame[], index = activeFrameIndex): void {
    animationFrames = frames;
    animationFramesByLayer.set(getAnimationLayerKey(activeBoardId, activeLayerId), frames);
    for (const frame of frames) frameBufferIds.set(frame.buffer, frame.id);
    activeFrameIndex = Math.max(0, Math.min(index, frames.length - 1));
  }

  function stopAnimationPlayback(): void {
    clearInterval(animationTimer);
    animationTimer = undefined;
    animationPlaying = false;
  }

  function addAnimationFrame(): void {
    if (
      animationFrames.length >= 256 ||
      (animationFrames.length + 1) * buffer.width * buffer.height > MAX_PROJECT_ANIMATION_PIXELS
    ) {
      notify('Достигнут допустимый лимит количества или общего размера кадров анимации.', 'error');
      return;
    }
    const id = `frame-${Date.now().toString(36)}-${animationFrames.length + 1}`;
    const frame = createAnimationFrame(id, buffer.width, buffer.height);
    frameBufferIds.set(frame.buffer, frame.id);
    setCurrentAnimationFrames(insertAnimationFrame(animationFrames, frame, activeFrameIndex + 1));
    selectAnimationFrame(activeFrameIndex + 1);
  }

  function duplicateAnimationFrameAtCurrent(): void {
    if (
      animationFrames.length >= 256 ||
      (animationFrames.length + 1) * buffer.width * buffer.height > MAX_PROJECT_ANIMATION_PIXELS
    ) {
      notify('Достигнут допустимый лимит количества или общего размера кадров анимации.', 'error');
      return;
    }
    const current = animationFrames[activeFrameIndex];
    if (!current) return;
    const frame = duplicateAnimationFrame(
      current,
      `frame-${Date.now().toString(36)}-${animationFrames.length + 1}`,
    );
    frameBufferIds.set(frame.buffer, frame.id);
    setCurrentAnimationFrames(insertAnimationFrame(animationFrames, frame, activeFrameIndex + 1));
    selectAnimationFrame(activeFrameIndex + 1);
  }

  function removeAnimationFrameAtCurrent(): void {
    if (animationFrames.length <= 1) return;
    const removed = animationFrames[activeFrameIndex];
    if (!removed) return;
    const nextIndex = Math.min(activeFrameIndex, animationFrames.length - 2);
    const remaining = removeAnimationFrame(animationFrames, activeFrameIndex);
    setCurrentAnimationFrames(remaining, -1);
    activeFrameIndex = -1;
    selectAnimationFrame(nextIndex);
    const obsoleteHistoryKeys = new Set(
      [...frameByHistoryKey].filter(([, frameId]) => frameId === removed.id).map(([key]) => key),
    );
    for (const timeline of [undoTimeline, redoTimeline]) {
      for (let index = timeline.length - 1; index >= 0; index--) {
        const entry = timeline[index]!;
        if ('historyKey' in entry && obsoleteHistoryKeys.has(entry.historyKey)) timeline.splice(index, 1);
      }
    }
    for (const key of obsoleteHistoryKeys) {
      frameByHistoryKey.delete(key);
      histories.delete(key);
    }
    syncHistory();
  }

  function setAnimationFrameDuration(index: number, durationMs: number): void {
    const frame = animationFrames[index];
    if (!frame) return;
    try {
      setCurrentAnimationFrames(animationFrames.map((entry, frameIndex) =>
        frameIndex === index ? updateFrameDuration(entry, durationMs) : entry));
      animationElapsed = 0;
      scheduleAutosave();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось изменить длительность кадра.', 'error');
    }
  }

  function toggleAnimationPlayback(): void {
    animationPlaying = !animationPlaying;
    clearInterval(animationTimer);
    animationTimer = undefined;
    animationElapsed = 0;
    if (!animationPlaying) return;
    animationLastTick = performance.now();
    animationTimer = setInterval(() => {
      const now = performance.now();
      const elapsed = Math.max(0, now - animationLastTick);
      animationLastTick = now;
      const position = advanceAnimation(
        animationFrames,
        { frameIndex: activeFrameIndex, elapsedInFrameMs: animationElapsed },
        elapsed,
      );
      animationElapsed = position.elapsedInFrameMs;
      if (position.frameIndex !== activeFrameIndex) selectAnimationFrame(position.frameIndex, false);
    }, 16);
  }

  function toggleWorkspaceDock(dock: DockId): void {
    if (dock === 'tools') {
      workspaceLayout = { ...workspaceLayout, toolsVisible: !workspaceLayout.toolsVisible };
    } else if (dock === 'palette') {
      workspaceLayout = { ...workspaceLayout, paletteVisible: !workspaceLayout.paletteVisible };
    } else {
      workspaceLayout = { ...workspaceLayout, timelineVisible: !workspaceLayout.timelineVisible };
    }
    scheduleWorkspaceSave();
  }

  function resizeWorkspace(dock: DockId, delta: number): void {
    const next = resizeWorkspaceDock(workspaceLayout, dock, delta);
    if (next === workspaceLayout) return;
    workspaceLayout = next;
    scheduleWorkspaceSave();
  }

  const workspacePanels: readonly { id: WorkspacePanelId; label: string }[] = [
    { id: 'colors', label: 'Colors' },
    { id: 'palette', label: 'Palette' },
    { id: 'layers', label: 'Layers' },
    { id: 'properties', label: 'Properties' },
    { id: 'brush-settings', label: 'Brush Settings' },
    { id: 'reference', label: 'Reference' },
    { id: 'history', label: 'History' },
    { id: 'navigator', label: 'Navigator' },
    { id: 'preview', label: 'Preview' },
    { id: 'brush-library', label: 'Brush Library' },
    { id: 'grid-settings', label: 'Grid Settings' },
    { id: 'export', label: 'Export' },
  ];

  function selectWorkspacePanel(id: WorkspacePanelId): void {
    workspaceLayout = { ...workspaceLayout, rightPanel: id };
    scheduleWorkspaceSave();
  }

  function handleEditorCommand(command: string): void {
    if (command.startsWith('tool:')) {
      const toolId = command.slice(5);
      const tool = TOOLS.find((entry) => entry.id === toolId);
      if (tool) selectTool(tool.id);
      return;
    }
    if (command.startsWith('panel:')) {
      const panel = workspacePanels.find((entry) => entry.id === command.slice(6));
      if (panel) selectWorkspacePanel(panel.id);
      return;
    }
    switch (command) {
      case 'save': void saveProject(); break;
      case 'export': void exportImage(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'clear': requestClear(); break;
      case 'delete-board': removeBoard(activeBoardId); break;
      case 'select-all': runSelectionAction('select-all'); break;
      case 'select-opaque': runSelectionAction('select-opaque'); break;
      case 'selection-mode:none': selectionMode = null; break;
      case 'selection-mode:rect': selectionMode = 'rect'; break;
      case 'selection-mode:ellipse': selectionMode = 'ellipse'; break;
      case 'selection-mode:lasso': selectionMode = 'lasso'; break;
      case 'selection-mode:polygon': selectionMode = 'polygon'; break;
      case 'selection-mode:wand': selectionMode = 'wand'; break;
      case 'selection-mode:color': selectionMode = 'color'; break;
      case 'selection-operation:replace': selectionOperation = 'replace'; break;
      case 'selection-operation:add': selectionOperation = 'add'; break;
      case 'selection-operation:subtract': selectionOperation = 'subtract'; break;
      case 'selection-operation:intersect': selectionOperation = 'intersect'; break;
      case 'toggle-grid': toggleGrid(); break;
      case 'fit': fitCanvas(); break;
      case 'center': canvasApi?.centerActiveBoard(); break;
      case 'zoom-in': canvasApi?.zoomBy(1); break;
      case 'zoom-out': canvasApi?.zoomBy(-1); break;
      case 'add-layer': addLayer(); break;
      case 'duplicate-layer': duplicateLayer(activeLayerId); break;
      case 'delete-layer': deleteLayer(activeLayerId); break;
      case 'frame-add': addAnimationFrame(); break;
      case 'frame-duplicate': duplicateAnimationFrameAtCurrent(); break;
      case 'frame-remove': removeAnimationFrameAtCurrent(); break;
      case 'frame-previous': selectAnimationFrame(Math.max(0, activeFrameIndex - 1)); break;
      case 'frame-next': selectAnimationFrame(Math.min(animationFrames.length - 1, activeFrameIndex + 1)); break;
      case 'animation-play': toggleAnimationPlayback(); break;
      case 'workspace-drawing': selectWorkspace('drawing'); break;
      case 'workspace-animation': selectWorkspace('animation'); break;
      case 'workspace-tileset': selectWorkspace('tileset'); break;
      case 'workspace-minimal': selectWorkspace('minimal'); break;
      case 'toggle-tools': toggleWorkspaceDock('tools'); break;
      case 'toggle-palette': toggleWorkspaceDock('palette'); break;
      case 'toggle-timeline': toggleWorkspaceDock('timeline'); break;
      case 'preview': openPreviewWindow(); break;
      case 'settings':
        settingsTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        settingsTab = 'general';
        settingsOpen = true;
        break;
      case 'help':
        helpTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        helpOpen = true;
        break;
      case 'feedback-notes': showFeedbackNotes(); break;
      case 'project-notes': showProjectNotes(); break;
      case 'welcome': showWelcome(); break;
      default: {
        const action = ([
          'invert', 'deselect', 'copy', 'cut', 'paste', 'clear', 'crop',
          'move-left', 'move-right', 'move-up', 'move-down',
          'flip-horizontal', 'flip-vertical', 'rotate-left', 'rotate-right', 'scale-up', 'scale-down',
        ] as const).find((entry) => command === `selection-action:${entry}`);
        if (action) runSelectionAction(action);
      }
    }
  }

  const editorMenuGroups = $derived<EditorMenuGroup[]>([
    { label: 'Файл', items: [
      { label: 'Открыть…', command: 'open' },
      { label: 'Сохранить проект', command: 'save' },
      { label: 'Экспорт изображения', command: 'export' },
      { label: 'Заметки проекта…', command: 'project-notes', separatorBefore: true },
    ] },
    { label: 'Правка', items: [
      { label: 'Отменить', command: 'undo', disabled: !canUndo },
      { label: 'Повторить', command: 'redo', disabled: !canRedo },
      { label: 'Выбрать всё', command: 'select-all', separatorBefore: true },
      { label: 'Выбрать непрозрачные пиксели', command: 'select-opaque' },
      { label: selectionMode ? 'Снять режим выделения' : 'Выделение: прямоугольник', command: selectionMode ? 'selection-mode:none' : 'selection-mode:rect', separatorBefore: true },
      { label: `${selectionMode === 'ellipse' ? '✓ ' : ''}Выделение: эллипс`, command: 'selection-mode:ellipse' },
      { label: `${selectionMode === 'lasso' ? '✓ ' : ''}Выделение: лассо`, command: 'selection-mode:lasso' },
      { label: `${selectionMode === 'polygon' ? '✓ ' : ''}Выделение: многоугольное лассо`, command: 'selection-mode:polygon' },
      { label: `${selectionMode === 'wand' ? '✓ ' : ''}Выделение: волшебная палочка`, command: 'selection-mode:wand' },
      { label: `${selectionMode === 'color' ? '✓ ' : ''}Выделение: цвет`, command: 'selection-mode:color' },
      { label: `${selectionOperation === 'replace' ? '✓ ' : ''}Заменить выделение`, command: 'selection-operation:replace', separatorBefore: true },
      { label: `${selectionOperation === 'add' ? '✓ ' : ''}Добавить к выделению`, command: 'selection-operation:add' },
      { label: `${selectionOperation === 'subtract' ? '✓ ' : ''}Вычесть из выделения`, command: 'selection-operation:subtract' },
      { label: `${selectionOperation === 'intersect' ? '✓ ' : ''}Пересечь выделения`, command: 'selection-operation:intersect' },
      { label: 'Инвертировать выделение', command: 'selection-action:invert', disabled: selectionMask === null, separatorBefore: true },
      { label: 'Снять выделение', command: 'selection-action:deselect', disabled: selectionMask === null },
      { label: 'Копировать', command: 'selection-action:copy', disabled: selectionMask === null },
      { label: 'Вырезать', command: 'selection-action:cut', disabled: selectionMask === null },
      { label: 'Вставить по центру', command: 'selection-action:paste', disabled: selectionClipboard === null },
      { label: 'Очистить выделенное', command: 'selection-action:clear', disabled: selectionMask === null },
      { label: 'Обрезать холст по выделению', command: 'selection-action:crop', disabled: selectionMask === null },
      { label: 'Сдвинуть влево', command: 'selection-action:move-left', disabled: selectionMask === null, separatorBefore: true },
      { label: 'Сдвинуть вправо', command: 'selection-action:move-right', disabled: selectionMask === null },
      { label: 'Сдвинуть вверх', command: 'selection-action:move-up', disabled: selectionMask === null },
      { label: 'Сдвинуть вниз', command: 'selection-action:move-down', disabled: selectionMask === null },
      { label: 'Отразить по горизонтали', command: 'selection-action:flip-horizontal', disabled: selectionMask === null },
      { label: 'Отразить по вертикали', command: 'selection-action:flip-vertical', disabled: selectionMask === null },
      { label: 'Повернуть влево на 90°', command: 'selection-action:rotate-left', disabled: selectionMask === null },
      { label: 'Повернуть вправо на 90°', command: 'selection-action:rotate-right', disabled: selectionMask === null },
      { label: 'Увеличить вдвое', command: 'selection-action:scale-up', disabled: selectionMask === null },
      { label: 'Уменьшить вдвое', command: 'selection-action:scale-down', disabled: selectionMask === null },
      { label: 'Очистить холст…', command: 'clear' },
    ] },
    { label: 'Вид', items: [
      { label: showGrid ? 'Скрыть сетку' : 'Показать сетку', command: 'toggle-grid' },
      { label: 'Вписать холсты', command: 'fit' },
      { label: 'Центрировать холст', command: 'center' },
      { label: 'Увеличить', command: 'zoom-in', separatorBefore: true },
      { label: 'Уменьшить', command: 'zoom-out' },
      { label: 'Предпросмотр', command: 'preview', separatorBefore: true },
    ] },
    { label: 'Изображение', items: [
      { label: 'Центрировать холст', command: 'center' },
      { label: 'Вписать холсты в окно', command: 'fit' },
    ] },
    { label: 'Холст', items: [
      { label: 'Удалить активный холст', command: 'delete-board', disabled: boards.length <= 1 },
    ] },
    { label: 'Слой', items: [
      { label: 'Новый слой', command: 'add-layer' },
      { label: 'Дублировать активный слой', command: 'duplicate-layer' },
      { label: 'Удалить активный слой', command: 'delete-layer' },
    ] },
    { label: 'Кадр', items: [
      { label: 'Предыдущий кадр', command: 'frame-previous' },
      { label: 'Следующий кадр', command: 'frame-next' },
      { label: 'Добавить кадр', command: 'frame-add', separatorBefore: true },
      { label: 'Дублировать кадр', command: 'frame-duplicate' },
      { label: 'Удалить кадр', command: 'frame-remove', disabled: animationFrames.length <= 1 },
    ] },
    { label: 'Анимация', items: [
      { label: animationPlaying ? 'Остановить' : 'Воспроизвести', command: 'animation-play' },
      { label: 'Показать Timeline', command: 'toggle-timeline' },
    ] },
    { label: 'Инструменты', items: TOOLS.map((tool) => ({
      label: `${tool.label} (${shortcutLabel(`tool:${tool.id}`)})`,
      command: `tool:${tool.id}`,
    })) },
    { label: 'Окно', items: [
      { label: 'Рабочее пространство: Рисование', command: 'workspace-drawing' },
      { label: 'Рабочее пространство: Анимация', command: 'workspace-animation' },
      { label: 'Рабочее пространство: Tileset', command: 'workspace-tileset' },
      { label: 'Рабочее пространство: Минимальное', command: 'workspace-minimal' },
      { label: workspaceLayout.toolsVisible ? 'Скрыть инструменты' : 'Показать инструменты', command: 'toggle-tools', separatorBefore: true },
      { label: workspaceLayout.paletteVisible ? 'Скрыть палитру' : 'Показать палитру', command: 'toggle-palette' },
      { label: workspaceLayout.timelineVisible ? 'Скрыть Timeline' : 'Показать Timeline', command: 'toggle-timeline' },
      ...workspacePanels.map((panel) => ({
        label: `Панель: ${panel.label}`,
        command: `panel:${panel.id}`,
        separatorBefore: panel.id === 'colors',
      })),
    ] },
    { label: 'Справка', items: [
      { label: 'Горячие клавиши', command: 'help' },
      { label: 'Заметки обратной связи', command: 'feedback-notes' },
      { label: 'Приветствие', command: 'welcome' },
      { label: 'Настройки', command: 'settings' },
    ] },
  ]);

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
      notes: notesText,
      references,
      customPalettes: customPalettes.length ? customPalettes : undefined,
      tilemap: tilemap ?? undefined,
      brushes: brushLibrary,
      metadata: projectMetadata,
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
          animationFrames: animationFramesByLayer.get(getAnimationLayerKey(board.id, layer.id))?.map((frame) => ({
            id: frame.id,
            durationMs: frame.durationMs,
            pixels: frame.buffer.data,
          })),
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
    if (activeBoardId === boardId && board.activeLayerId !== nextActiveLayerId) {
      const targetLayer = layers.find((layer) => layer.id === nextActiveLayerId)!;
      const targetFrames = getAnimationFramesForLayer(boardId, targetLayer);
      animationFrames = targetFrames;
      activeFrameIndex = 0;
      stopAnimationPlayback();
      for (const frame of targetFrames) frameBufferIds.set(frame.buffer, frame.id);
      layers = layers.map((layer) => layer.id === nextActiveLayerId
        ? { ...layer, buffer: targetFrames[0]!.buffer }
        : layer);
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
    const restoredFramesByLayer = direction === 'undo'
      ? entry.beforeAnimationFramesByLayer
      : entry.afterAnimationFramesByLayer;
    if (restoredFramesByLayer) {
      animationFramesByLayer.clear();
      for (const [key, frames] of restoredFramesByLayer) animationFramesByLayer.set(key, frames);
      animationFrames = animationFramesByLayer.get(getAnimationLayerKey(entry.boardId, layerId)) ?? animationFrames;
      activeFrameIndex = direction === 'undo'
        ? entry.beforeActiveFrameIndex ?? 0
        : entry.afterActiveFrameIndex ?? 0;
      for (const frames of animationFramesByLayer.values()) {
        for (const frame of frames) frameBufferIds.set(frame.buffer, frame.id);
      }
    }
    replaceLayerStack(entry.boardId, layers, layerId, groups);
    const restoredFrames = direction === 'undo' ? entry.beforeAnimationFrames : entry.afterAnimationFrames;
    if (restoredFrames) {
      animationFrames = restoredFrames;
      animationFramesByLayer.set(getAnimationLayerKey(entry.boardId, layerId), restoredFrames);
      activeFrameIndex = direction === 'undo'
        ? entry.beforeActiveFrameIndex ?? 0
        : entry.afterActiveFrameIndex ?? 0;
      for (const frame of animationFrames) frameBufferIds.set(frame.buffer, frame.id);
    }
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

  function removeBoard(id: string): void {
    if (boards.length <= 1) {
      notify('В проекте должен остаться хотя бы один холст.', 'error');
      return;
    }
    const index = boards.findIndex((board) => board.id === id);
    if (index < 0) return;
    const board = boards[index]!;
    const previousActiveBoardId = activeBoardId;
    const fallbackActiveBoardId = id === activeBoardId
      ? boards[index > 0 ? index - 1 : 1]!.id
      : activeBoardId;
    boards = boards.filter((entry) => entry.id !== id);
    if (id === activeBoardId) setActiveBoard(fallbackActiveBoardId);
    pushUndoEntry({
      kind: 'board',
      action: { kind: 'remove', board, index, previousActiveBoardId, fallbackActiveBoardId },
    });
    syncHistory();
    scheduleAutosave();
    notify('Холст удалён. Отменить удаление можно через Ctrl+Z.');
  }

  function fitBoardToArtwork(id: string): void {
    const board = boards.find((entry) => entry.id === id);
    if (!board || id !== activeBoardId) return;

    for (const layer of board.layers) getAnimationFramesForLayer(id, layer);

    let minX = board.buffer.width;
    let minY = board.buffer.height;
    let maxX = -1;
    let maxY = -1;
    const framesByLayer = new Map(
      board.layers.map((layer) => [
        layer.id,
        animationFramesByLayer.get(getAnimationLayerKey(id, layer.id))!,
      ]),
    );

    for (const frames of framesByLayer.values()) {
      for (const frame of frames) {
        const { width, height, data } = frame.buffer;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] === 0) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      notify('Нечего подгонять: холст не содержит непрозрачных пикселей.', 'error');
      return;
    }

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    if (width === board.buffer.width && height === board.buffer.height) {
      notify('Холст уже подогнан под содержимое.');
      return;
    }

    stopAnimationPlayback();
    const cropBuffer = (source: PixelBuffer): PixelBuffer => {
      const cropped = new PixelBuffer(width, height);
      for (let y = 0; y < height; y++) {
        const sourceStart = ((minY + y) * source.width + minX) * 4;
        const targetStart = y * width * 4;
        cropped.data.set(source.data.subarray(sourceStart, sourceStart + width * 4), targetStart);
      }
      cropped.markAllDirty();
      return cropped;
    };

    const beforeLayers = board.layers;
    const beforeAnimationFrames = animationFrames;
    const beforeActiveFrameIndex = activeFrameIndex;
    const beforeAnimationFramesByLayer = new Map(animationFramesByLayer);
    const afterAnimationFramesByLayer = new Map(beforeAnimationFramesByLayer);
    for (const layer of board.layers) {
      const key = getAnimationLayerKey(id, layer.id);
      const croppedFrames = framesByLayer.get(layer.id)!.map((frame) => {
        const next = createAnimationFrame(frame.id, width, height, cropBuffer(frame.buffer).data, frame.durationMs);
        frameBufferIds.set(next.buffer, next.id);
        return next;
      });
      afterAnimationFramesByLayer.set(key, croppedFrames);
    }

    const activeLayerFrames = afterAnimationFramesByLayer.get(getAnimationLayerKey(id, activeLayerId))!;
    const afterLayers = board.layers.map((layer) => {
      const frames = afterAnimationFramesByLayer.get(getAnimationLayerKey(id, layer.id))!;
      return {
        ...layer,
        buffer: frames[layer.id === activeLayerId ? activeFrameIndex : 0]!.buffer,
      };
    });

    animationFramesByLayer.clear();
    for (const [key, frames] of afterAnimationFramesByLayer) animationFramesByLayer.set(key, frames);
    const beforeSelection = selectionMask;
    selectionMask = null;
    selectionPreview = null;
    replaceLayerStack(id, afterLayers, activeLayerId, board.groups);
    animationFrames = activeLayerFrames;
    activeFrameIndex = Math.min(beforeActiveFrameIndex, activeLayerFrames.length - 1);
    pushUndoEntry({
      kind: 'layer-stack',
      boardId: id,
      beforeLayers,
      afterLayers,
      beforeGroups: board.groups,
      afterGroups: board.groups,
      beforeActiveLayerId: activeLayerId,
      afterActiveLayerId: activeLayerId,
      beforeSelection,
      afterSelection: null,
      beforeAnimationFrames,
      afterAnimationFrames: activeLayerFrames,
      beforeAnimationFramesByLayer,
      afterAnimationFramesByLayer,
      beforeActiveFrameIndex,
      afterActiveFrameIndex: activeFrameIndex,
    });
    cursor = null;
    scheduleAutosave();
    canvasApi?.requestRender();
    notify(`Холст подогнан под изображение: ${width}×${height} px. Действие можно отменить через Ctrl+Z.`);
  }

  function findBoardPosition(width: number, height: number, origin: Artboard): { x: number; y: number } | null {
    const gap = 32;
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
        const tooClose = boards.some((board) => {
          const separatedX = candidate.x + width + gap <= board.x ||
            board.x + board.buffer.width + gap <= candidate.x;
          const separatedY = candidate.y + height + gap <= board.y ||
            board.y + board.buffer.height + gap <= candidate.y;
          return !separatedX && !separatedY;
        });
        if (!tooClose) return { x: candidate.x, y: candidate.y };
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
      notesStatus = 'сохранено в проекте';
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
    void customPalettes;
    void projectMetadata;
    if (!autosaveArmed) {
      autosaveArmed = true;
      return;
    }
    scheduleAutosave();
  });

  onDestroy(() => {
    clearTimeout(autosaveTimer);
    clearTimeout(noticeTimer);
    if (shortcutSequenceTimer !== undefined) clearTimeout(shortcutSequenceTimer);
    clearInterval(animationTimer);
    if (workspaceSaveTimer !== undefined) {
      clearTimeout(workspaceSaveTimer);
      if (!saveWorkspaceLayout(storage, workspaceLayout)) {
        console.error('Не удалось сохранить раскладку рабочего пространства.');
      }
    }
  });

  // ——— История ———

  function syncHistory(): void {
    historyRevision++;
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

  function trimTilemapHistory(): void {
    const getUsage = (): { entries: number; bytes: number } => {
      const retainedArrays = new Set<object>();
      let entries = 0;
      let bytes = 0;
      for (const action of [...undoTimeline, ...redoTimeline]) {
        if (action.kind !== 'tilemap') continue;
        entries++;
        for (const snapshot of [action.before, action.after]) {
          if (!snapshot) continue;
          for (const layer of snapshot.layers) {
            if (retainedArrays.has(layer.cells)) continue;
            retainedArrays.add(layer.cells);
            bytes += layer.cells.length * 8;
          }
          for (const tile of snapshot.tiles) {
            if (retainedArrays.has(tile.pixels)) continue;
            retainedArrays.add(tile.pixels);
            bytes += tile.pixels.byteLength;
          }
        }
      }
      return { entries, bytes };
    };

    let usage = getUsage();
    while (usage.entries > MAX_TILEMAP_HISTORY_ENTRIES || usage.bytes > MAX_TILEMAP_HISTORY_BYTES) {
      const oldestUndo = undoTimeline.findIndex((entry) => entry.kind === 'tilemap');
      if (oldestUndo >= 0) undoTimeline.splice(oldestUndo, 1);
      else {
        const oldestRedo = redoTimeline.findIndex((entry) => entry.kind === 'tilemap');
        if (oldestRedo < 0) break;
        redoTimeline.splice(oldestRedo, 1);
      }
      usage = getUsage();
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
    const boardFrames = getAnimationFramesForLayer(id, layer);
    const activeFrame = boardFrames[0]!;
    if (activeFrame.buffer !== layer.buffer) {
      const layers = board.layers.map((entry) => entry.id === layer.id
        ? { ...entry, buffer: activeFrame.buffer }
        : entry);
      const groupBuffers = new Map<string, PixelBuffer>();
      const composite = compositeLayers(
        activeFrame.buffer.width,
        activeFrame.buffer.height,
        layers,
        undefined,
        undefined,
        board.groups,
        groupBuffers,
      );
      boards = boards.map((entry) => entry.id === id
        ? { ...entry, layers, groupBuffers, buffer: composite }
        : entry);
      buffer = activeFrame.buffer;
    }
    const activeLayer = boards.find((entry) => entry.id === id)!.layers
      .find((entry) => entry.id === activeLayerId)!;
    const key = getHistoryKey(id, activeLayer);
    history = histories.get(key) ?? new History();
    histories.set(key, history);
    animationFrames = boardFrames;
    activeFrameIndex = 0;
    stopAnimationPlayback();
    cursor = null;
  }

  function applyBoardAction(action: BoardAction, direction: 'undo' | 'redo'): void {
    if (action.kind === 'move') {
      applyBoardPositions(direction === 'undo' ? action.before : action.after);
      scheduleAutosave();
      return;
    }
    if (action.kind === 'remove') {
      if (direction === 'undo') {
        boards = [...boards.slice(0, action.index), action.board, ...boards.slice(action.index)];
        setActiveBoard(action.previousActiveBoardId);
      } else {
        boards = boards.filter((board) => board.id !== action.board.id);
        if (activeBoardId === action.board.id) setActiveBoard(action.fallbackActiveBoardId);
      }
      syncHistory();
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

  async function fillAt(x: number, y: number, slot: ColorSlot): Promise<void> {
    if (fillInProgress) return;
    fillInProgress = true;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    let historyStarted = false;
    try {
      const color = slot === 'primary' ? primary : secondary;
      rememberColor(color);
      beginStroke();
      historyStarted = true;
      await floodFillAsync(buffer, x, y, color, {
        contiguous: drawingSettings.fillContiguous,
        tolerance: drawingSettings.fillTolerance,
        connectivity: drawingSettings.fillConnectivity,
        protectAlpha: drawingSettings.fillProtectAlpha,
        opacity: brushOpacity / 100,
        selection: selectionMask?.data,
        sampleBuffer: drawingSettings.sampleMerged ? activeBoard.buffer : undefined,
      });
      endStroke('commit');
      historyStarted = false;
    } catch (error) {
      if (historyStarted) endStroke('rollback');
      notify(error instanceof Error ? error.message : 'Не удалось выполнить заливку.', 'error');
    } finally {
      fillInProgress = false;
      canvasApi?.requestRender();
    }
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
    if ('historyKey' in entry) {
      const frameId = frameByHistoryKey.get(entry.historyKey);
      const frameIndex = animationFrames.findIndex((frame) => frame.id === frameId);
      if (frameIndex >= 0) selectAnimationFrame(frameIndex, false);
    }
    if (entry.kind === 'board') {
      applyBoardAction(entry.action, 'undo');
    } else if (entry.kind === 'tilemap') {
      tilemap = entry.before;
      scheduleAutosave();
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
    if ('historyKey' in entry) {
      const frameId = frameByHistoryKey.get(entry.historyKey);
      const frameIndex = animationFrames.findIndex((frame) => frame.id === frameId);
      if (frameIndex >= 0) selectAnimationFrame(frameIndex, false);
    }
    if (entry.kind === 'board') {
      applyBoardAction(entry.action, 'redo');
    } else if (entry.kind === 'tilemap') {
      tilemap = entry.after;
      scheduleAutosave();
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
    else notify('Размер добавлен до закрытия приложения, но не сохранён: хранилище недоступно.', 'error');
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

  function setSecondaryColorDrawing(enabled: boolean): void {
    secondaryColorDrawing = enabled;
    if (!saveSecondaryColorDrawing(storage, enabled)) {
      notify('Настройка рисования изменена, но сохранить её не удалось.', 'error');
    }
  }

  function setTheme(next: ThemePreference): void {
    theme = next;
    if (!saveThemePreference(storage, next)) {
      notify('Не удалось сохранить тему. Она будет применяться только до закрытия страницы.', 'error');
    }
  }

  function setShortcuts(next: ShortcutMap): void {
    if (findShortcutConflicts(next).length) {
      notify('Не удалось применить схему: сочетания клавиш конфликтуют.', 'error');
      return;
    }
    spaceHeld = false;
    temporaryPicker = false;
    shortcuts = next;
    if (!saveShortcutMap(storage, next)) {
      notify('Сочетания изменены, но не удалось сохранить их в локальном хранилище.', 'error');
    }
  }

  function openSettings(tab: 'general' | 'background' | 'hotkeys', trigger: HTMLElement): void {
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
    if (activeToolId === 'eraser') eraserSize = clampBrushSize(size);
    else pencilSize = clampBrushSize(size);
    selectedBrushId = '';
  }

  function setToolBrushSize(tool: 'pencil' | 'eraser', size: number): void {
    if (tool === 'eraser') eraserSize = clampBrushSize(size);
    else pencilSize = clampBrushSize(size);
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
      const totalPixels = references.reduce((sum, reference) => sum + reference.width * reference.height, 0);
      const availablePixels = MAX_REFERENCE_TOTAL_PIXELS - totalPixels;
      if (availablePixels < 1) {
        notify('Достигнут общий лимит пикселей референсов. Удалите или уменьшите один из референсов.', 'error');
        return;
      }
      const image = await decodeRasterImage(file, { maxPixels: availablePixels });

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
    const next = allPalettes.find((entry) => entry.id === id);
    if (!next) {
      notify('Не удалось выбрать: палитра не найдена.', 'error');
      return;
    }
    paletteId = id;
    if (!freeColor) {
      primary = nearestPaletteColor(next, primary);
      secondary = nearestPaletteColor(next, secondary);
    }
  }

  function createProjectPalette(name: string, colors: RGBA[]): void {
    if (customPalettes.length >= MAX_CUSTOM_PALETTES) {
      notify('Достигнут лимит пользовательских палитр.', 'error');
      return;
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const baseId = `custom-${slug || 'palette'}-${Date.now().toString(36)}`;
    let id = baseId;
    let suffix = 2;
    while (customPalettes.some((entry) => entry.id === id)) id = `${baseId}-${suffix++}`;
    try {
      const nextPalettes = parseCustomPalettes([...customPalettes, { id, name, colors }]);
      const created = nextPalettes.find((entry) => entry.id === id)!;
      customPalettes = nextPalettes;
      paletteId = id;
      if (!freeColor) {
        primary = nearestPaletteColor(created, primary);
        secondary = nearestPaletteColor(created, secondary);
      }
      notify(`Палитра «${name}» добавлена в проект.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось создать палитру.', 'error');
    }
  }

  function deleteProjectPalette(id: string): void {
    customPalettes = customPalettes.filter((entry) => entry.id !== id);
    if (paletteId === id) {
      paletteId = DEFAULT_PALETTE_ID;
      if (!freeColor) {
        const defaultPalette = getPalette(DEFAULT_PALETTE_ID);
        primary = nearestPaletteColor(defaultPalette, primary);
        secondary = nearestPaletteColor(defaultPalette, secondary);
      }
    }
    notify('Пользовательская палитра удалена из проекта.');
  }

  function updateProjectMetadata(metadata: ProjectMetadata): void {
    projectMetadata = metadata;
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

  async function saveProject(): Promise<void> {
    const filename = `pixel-art-${boards.length}-canvases.json`;
    try {
      const text = serializeProject(currentProject());
      const blob = new Blob([text], { type: 'application/json' });
      if (await saveDesktopBlob(blob, filename) === 'saved') notify('Проект сохранён в файл.');
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
      const targetBoard = boards.find((board) => board.id === activeBoardId);
      if (!targetBoard) throw new Error('Выбранный холст не найден.');
      if (targetBoard.layers.length >= MAX_PROJECT_LAYERS) {
        notify(`На выбранном холсте уже достигнут лимит слоёв (${MAX_PROJECT_LAYERS}).`, 'error');
        return;
      }
      if (getTotalLayerPixels() + targetBoard.buffer.width * targetBoard.buffer.height > MAX_PROJECT_TOTAL_PIXELS) {
        notify('Превышен лимит общего объёма пиксельных данных проекта.', 'error');
        return;
      }
      const image = await decodeRasterImage(file, {
        fitWithin: { width: targetBoard.buffer.width, height: targetBoard.buffer.height },
      });
      pending = { kind: 'image', image, fileName: file.name, boardId: targetBoard.id };
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

    try {
      const blob =
        exportFormat === 'png'
          ? await exportPngBlob(exportBuffer, exportScale)
          : await exportRasterBlob(exportBuffer, exportScale, exportFormat, canvasBackground);
      if (await saveDesktopBlob(blob, filename) !== 'saved') return;
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
    animationFramesByLayer.clear();
    boards = project.canvases
      ? project.canvases.map((canvas) => makeArtboard(
          canvas.id, canvas.x, canvas.y, canvas.width, canvas.height, canvas.pixels, canvas.layers, canvas.activeLayerId,
        ))
      : [makeArtboard(
          project.activeCanvasId ?? 'canvas-1', 0, 0, project.width, project.height, project.pixels,
        )];
    activeBoardId = project.activeCanvasId ?? boards[0]!.id;
    let activeBoard = boards.find((board) => board.id === activeBoardId)!;
    activeLayerId = activeBoard.activeLayerId;
    const activeLayer = activeBoard.layers.find((layer) => layer.id === activeLayerId)!;
    for (const canvas of project.canvases ?? []) {
      for (const layer of canvas.layers ?? []) {
        if (!layer.animationFrames) continue;
        animationFramesByLayer.set(
          getAnimationLayerKey(canvas.id, layer.id),
          layer.animationFrames.map((frame) =>
            createAnimationFrame(frame.id, canvas.width, canvas.height, frame.pixels, frame.durationMs)),
        );
      }
    }
    const activeAnimationKey = getAnimationLayerKey(activeBoardId, activeLayerId);
    const activeLayerFrames = animationFramesByLayer.get(activeAnimationKey) ??
      project.animationFrames?.map((frame) =>
        createAnimationFrame(frame.id, activeLayer.buffer.width, activeLayer.buffer.height, frame.pixels, frame.durationMs),
      ) ?? [{
        id: 'frame-1',
        durationMs: 100,
        buffer: activeLayer.buffer,
      }];
    animationFramesByLayer.set(activeAnimationKey, activeLayerFrames);
    animationFrames = activeLayerFrames;
    activeFrameIndex = 0;
    for (const frames of animationFramesByLayer.values()) {
      for (const frame of frames) frameBufferIds.set(frame.buffer, frame.id);
    }
    for (const frame of animationFrames) frameBufferIds.set(frame.buffer, frame.id);
    const firstFrameBuffer = animationFrames[0]!.buffer;
    activeBoard = {
      ...activeBoard,
      layers: activeBoard.layers.map((layer) => layer.id === activeLayerId
        ? { ...layer, buffer: firstFrameBuffer }
        : layer),
    };
    const groupBuffers = new Map<string, PixelBuffer>();
    activeBoard.buffer = compositeLayers(
      firstFrameBuffer.width,
      firstFrameBuffer.height,
      activeBoard.layers,
      undefined,
      undefined,
      activeBoard.groups,
      groupBuffers,
    );
    activeBoard.groupBuffers = groupBuffers;
    boards = boards.map((board) => board.id === activeBoardId ? activeBoard : board);
    buffer = firstFrameBuffer;
    buffer.setClipMask(null);
    histories.clear();
    frameByHistoryKey.clear();
    for (const board of boards) {
      for (const layer of board.layers) histories.set(getHistoryKey(board.id, layer), new History());
    }
    undoTimeline.length = 0;
    redoTimeline.length = 0;
    history = histories.get(getHistoryKey(activeBoardId, activeBoard.layers.find((layer) => layer.id === activeLayerId)!))!;
    paletteId = project.paletteId;
    customPalettes = project.customPalettes ?? [];
    freeColor = project.freeColor;
    primary = project.primary;
    secondary = project.secondary;
    recent = project.recent;
    notesText = project.notes ?? '';
    notesUpdatedAt = Date.now();
    notesStatus = 'сохранено в проекте';
    references = project.references?.map((reference) => ({ ...reference })) ?? [];
    tilemap = project.tilemap ?? null;
    projectMetadata = project.metadata ?? {};
    if (project.brushes !== undefined) {
      brushLibrary = mergeBrushDefinitions(brushLibrary, project.brushes);
      persistBrushLibrary();
    }
    stopAnimationPlayback();
    selectedReferenceId = references[0]?.id ?? null;
    syncHistory();
    cursor = null;
    scheduleAutosave();
  }

  function updateTilemap(next: TilemapData, groupId: string | null = null): void {
    if (tilemap === next) return;
    const previousEntry = undoTimeline[undoTimeline.length - 1];
    if (groupId && previousEntry?.kind === 'tilemap' && previousEntry.groupId === groupId) {
      previousEntry.after = next;
    } else {
      pushUndoEntry({ kind: 'tilemap', before: tilemap, after: next, groupId });
    }
    tilemap = next;
    trimTilemapHistory();
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
      notify(`Холст очищен. Действие можно отменить сочетанием ${shortcutLabel('undo')}.`);
    } else if (action.kind === 'resize') {
      const currentBoard = boards.find((board) => board.id === activeBoardId)!;
      const beforeLayers = currentBoard.layers;
      const beforeAnimationFrames = animationFrames;
      for (const layer of currentBoard.layers) getAnimationFramesForLayer(activeBoardId, layer);
      const beforeAnimationFramesByLayer = new Map(animationFramesByLayer);
      const afterAnimationFramesByLayer = new Map(animationFramesByLayer);
      for (const layer of currentBoard.layers) {
        const key = getAnimationLayerKey(activeBoardId, layer.id);
        const sourceFrames = animationFramesByLayer.get(key)!;
        const resizedFrames = sourceFrames.map((frame) => {
          const resized = frame.buffer.resized(action.width, action.height);
          const next = createAnimationFrame(frame.id, action.width, action.height, resized.data, frame.durationMs);
          frameBufferIds.set(next.buffer, next.id);
          return next;
        });
        afterAnimationFramesByLayer.set(key, resizedFrames);
      }
      const activeLayerKey = getAnimationLayerKey(activeBoardId, activeLayerId);
      const afterAnimationFrames = afterAnimationFramesByLayer.get(activeLayerKey)!;
      const afterLayers = currentBoard.layers.map((layer) => {
        const layerFrames = afterAnimationFramesByLayer.get(getAnimationLayerKey(activeBoardId, layer.id))!;
        return {
          ...layer,
          buffer: layerFrames[layer.id === activeLayerId ? activeFrameIndex : 0]!.buffer,
        };
      });
      animationFramesByLayer.clear();
      for (const [key, frames] of afterAnimationFramesByLayer) animationFramesByLayer.set(key, frames);
      selectionMask = null;
      selectionPreview = null;
      replaceLayerStack(activeBoardId, afterLayers, activeLayerId);
      animationFrames = afterAnimationFrames;
      pushUndoEntry({
        kind: 'layer-stack',
        boardId: activeBoardId,
        beforeLayers,
        afterLayers,
        beforeGroups: currentBoard.groups,
        afterGroups: currentBoard.groups,
        beforeActiveLayerId: activeLayerId,
        afterActiveLayerId: activeLayerId,
        beforeAnimationFrames,
        afterAnimationFrames,
        beforeAnimationFramesByLayer,
        afterAnimationFramesByLayer,
        beforeActiveFrameIndex: activeFrameIndex,
        afterActiveFrameIndex: activeFrameIndex,
      });
      cursor = null;
      scheduleAutosave();
    } else if (action.kind === 'image') {
      const board = boards.find((entry) => entry.id === action.boardId);
      if (!board) {
        notify('Выбранный холст больше не существует. Изображение не импортировано.', 'error');
        return;
      }
      if (board.layers.length >= MAX_PROJECT_LAYERS) {
        notify(`На выбранном холсте уже достигнут лимит слоёв (${MAX_PROJECT_LAYERS}).`, 'error');
        return;
      }
      if (getTotalLayerPixels() + board.buffer.width * board.buffer.height > MAX_PROJECT_TOTAL_PIXELS) {
        notify('Превышен лимит общего объёма пиксельных данных проекта.', 'error');
        return;
      }
      if (action.image.width !== board.buffer.width || action.image.height !== board.buffer.height) {
        notify('Размер выбранного холста изменился. Импортируйте изображение повторно.', 'error');
        return;
      }
      const id = `${board.id}-photo-${Date.now().toString(36)}-${layerSequence++}`;
      const photoName = action.fileName.replace(/\.[^.]+$/, '').trim().slice(0, 75) ||
        `Изображение ${board.layers.length + 1}`;
      const layer = createRasterLayer(
        id,
        `Фото ${photoName}`,
        board.buffer.width,
        board.buffer.height,
        action.image.pixels,
      );
      histories.set(getHistoryKey(board.id, layer), new History());
      commitLayerStack(board.id, [...board.layers, layer], layer.id);
      if (activeBoardId === board.id) cursor = null;
      notify('Фото импортировано отдельным слоем на выбранный холст.');
    } else {
      applyProject(action.project);
      notify('Проект открыт.');
    }
  }

  function cancelPending(): void {
    pending = null;
  }

  function describePending(action: PendingAction): { title: string; message: string; confirmText: string } {
    if (action.kind === 'clear') {
      return {
        title: 'Очистить холст?',
        message: `Все пиксели будут удалены. Очистку можно отменить сочетанием ${shortcutLabel('undo')}.`,
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
      const board = boards.find((entry) => entry.id === action.boardId);
      return {
        title: 'Импортировать изображение?',
        message: `Фото «${action.fileName}» будет вписано в выбранный холст ${board?.buffer.width ?? action.image.width}×${board?.buffer.height ?? action.image.height} с сохранением пропорций и добавлено отдельным слоем. Остальные холсты не изменятся.`,
        confirmText: 'Импортировать',
      };
    }

    const from = `${buffer.width}×${buffer.height}`;
    const to = `${action.width}×${action.height}`;
    const crops = action.width < buffer.width || action.height < buffer.height;
    let message = `Размер сетки изменится с ${from} на ${to}. Содержимое сохранится от левого верхнего угла.`;
    if (crops) message += ' Всё, что не поместится в новый размер, будет обрезано.';
    message += ` Изменение можно отменить (${shortcutLabel('undo')}).`;
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

  function onKeyDown(e: KeyboardEvent): void {
    if (fillInProgress || pending || welcomeOpen || feedbackNotesOpen || projectNotesOpen || helpOpen || settingsOpen || isTypingTarget(e.target)) return;

    if (e.repeat) return;
    const resolution = resolveShortcutEvent(shortcuts, pendingShortcutSequence, e);
    if (shortcutSequenceTimer !== undefined) {
      clearTimeout(shortcutSequenceTimer);
      shortcutSequenceTimer = undefined;
    }
    pendingShortcutSequence = resolution.pending;
    if (resolution.pending.length) {
      shortcutSequenceTimer = setTimeout(() => {
        pendingShortcutSequence = [];
        shortcutSequenceTimer = undefined;
      }, 1200);
      e.preventDefault();
      return;
    }

    const action = resolution.action;
    if (!action) return;
    e.preventDefault();

    if (action === 'temporary-picker') {
      temporaryPicker = true;
      return;
    }
    if (action === 'pan') {
      spaceHeld = true;
      return;
    }
    if (e.repeat) return;

    if (action.startsWith('tool:')) {
      const tool = TOOLS.find((entry) => `tool:${entry.id}` === action);
      if (tool) selectTool(tool.id);
      return;
    }
    switch (action) {
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'save': saveProject(); break;
      case 'copy': runSelectionAction('copy'); break;
      case 'cut': runSelectionAction('cut'); break;
      case 'paste': runSelectionAction('paste'); break;
      case 'swap-colors': swapColors(); break;
      case 'toggle-grid': toggleGrid(); break;
      case 'fit': fitCanvas(); break;
      case 'help':
        helpTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        helpOpen = true;
        break;
      case 'zoom-in': canvasApi?.zoomBy(1); break;
      case 'zoom-out': canvasApi?.zoomBy(-1); break;
      default: {
        const brushSizeMatch = /^brush-size:(\d)$/.exec(action);
        if (brushSizeMatch) setBrushSize(Number(brushSizeMatch[1]));
      }
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    const action = getTemporaryActionForCode(shortcuts, e.code);
    if (action === 'temporary-picker') temporaryPicker = false;
    if (action === 'pan') spaceHeld = false;
    if (action && !pending && !welcomeOpen && !feedbackNotesOpen && !projectNotesOpen && !helpOpen && !settingsOpen && !isTypingTarget(e.target)) e.preventDefault();
  }

  function onWindowBlur(): void {
    spaceHeld = false;
    temporaryPicker = false;
    pendingShortcutSequence = [];
    if (shortcutSequenceTimer !== undefined) clearTimeout(shortcutSequenceTimer);
    shortcutSequenceTimer = undefined;
  }

  if (storage) {
    try {
      const savedBrushes = storage.getItem(BRUSH_LIBRARY_KEY);
      if (savedBrushes) {
        brushLibrary = mergeBrushDefinitions(parseBrushLibrary(savedBrushes), untrack(() => brushLibrary));
      }
    } catch (error) {
      brushLibraryError = `Библиотека кистей повреждена и не загружена: ${error instanceof Error ? error.message : String(error)}`;
    }
  } else {
    brushLibraryError = 'Библиотека кистей недоступна: нет доступа к хранилищу приложения.';
  }

  if (preferences.error) notify(preferences.error, 'error');
  if (savedShortcuts.error) notify(savedShortcuts.error, 'error');
  if (savedWorkspace.error) notify(savedWorkspace.error, 'error');
  if (brushLibraryError) notify(brushLibraryError, 'error');
</script>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} onblur={onWindowBlur} onpagehide={flushAutosave} />
<svelte:document onvisibilitychange={onVisibilityChange} />

<div class="app">
  <EditorMenuBar
    groups={editorMenuGroups}
    oncommand={handleEditorCommand}
    onopen={(file) => void importProjectFile(file)}
  />
  <ProjectBar
    {canUndo}
    {canRedo}
    {exportFormat}
    {exportScale}
    {availableExportScales}
    exportWidth={buffer.width * exportScale}
    exportHeight={buffer.height * exportScale}
    undoShortcut={shortcutLabel('undo')}
    redoShortcut={shortcutLabel('redo')}
    saveShortcut={shortcutLabel('save')}
    helpShortcut={shortcutLabel('help')}
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
    onwelcome={(trigger) => showWelcome(trigger)}
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
    {tilemapMode}
    {symmetryX}
    {symmetryY}
    {customSizes}
    undoShortcut={shortcutLabel('undo')}
    ontogglegrid={toggleGrid}
    ongridmode={setGridMode}
    ongridspacing={setGridSpacing}
    onsnaptogrid={setSnapToGrid}
    oncheckerboard={setCheckerboard}
    ontiledmode={(enabled) => (tiledMode = enabled)}
    ontilemapmode={(enabled) => (tilemapMode = enabled)}
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

  <WorkspaceControls
    workspace={workspaceLayout.id}
    toolsVisible={workspaceLayout.toolsVisible}
    paletteVisible={workspaceLayout.paletteVisible}
    timelineVisible={workspaceLayout.timelineVisible}
    onworkspace={selectWorkspace}
    ontoggletools={() => toggleWorkspaceDock('tools')}
    ontogglepalette={() => toggleWorkspaceDock('palette')}
    ontoggletimeline={() => toggleWorkspaceDock('timeline')}
  />

  <div class="body" class:no-tools={!workspaceLayout.toolsVisible} class:no-palette={!workspaceLayout.paletteVisible}>
    {#if workspaceLayout.toolsVisible}
    <div class="dock tool-dock" style:width="{workspaceLayout.toolsWidth}px">
    <ToolPanel
      panelWidth={workspaceLayout.toolsWidth}
      tools={keyboardTools}
      {activeToolId}
      {pencilSize}
      {eraserSize}
      settings={drawingSettings}
      onselect={selectTool}
      onbrushsize={setToolBrushSize}
      onsettings={updateDrawingSettings}
      onaddboard={addBoard}
    />
    </div>
    <DockSplitter
      label="Изменить ширину панели инструментов"
      value={workspaceLayout.toolsWidth}
      min={48}
      max={180}
      valueDirection={1}
      onresize={(delta) => resizeWorkspace('tools', delta)}
    />
    {/if}

    <section class="workspace" aria-label="Холст">
      {#if tilemapMode}
        <TilemapEditor
          sourceWidth={activeBoard.buffer.width}
          sourceHeight={activeBoard.buffer.height}
          sourcePixels={activeBoard.buffer.data}
          primaryColor={primary}
          secondaryColor={secondary}
          {tilemap}
          ontilemapchange={updateTilemap}
          onclose={() => (tilemapMode = false)}
        />
      {:else}
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
        {secondaryColorDrawing}
        {brushSize}
        {brushShape}
        {brushOpacity}
        brushDefinition={brushLibrary.find((entry) => entry.id === selectedBrushId) ?? null}
        settings={drawingSettings}
        {temporaryPicker}
        {fillInProgress}
        onfill={(x, y, slot) => void fillAt(x, y, slot)}
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
        ondeleteboard={removeBoard}
        onfitboard={fitBoardToArtwork}
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
      {/if}
      {#if !workspaceLayout.paletteVisible}
        <button
          type="button"
          class="show-palette-button"
          aria-label="Показать правую панель"
          aria-controls="workspace-panel-content"
          aria-expanded="false"
          title="Показать правую панель"
          onclick={() => toggleWorkspaceDock('palette')}
        >
          <span class="panel-chevron" aria-hidden="true"></span>
          <span>Панели</span>
        </button>
      {/if}
    </section>

    {#if workspaceLayout.paletteVisible}
    <DockSplitter
      label="Изменить ширину панели палитры"
      value={workspaceLayout.paletteWidth}
      min={180}
      max={400}
      valueDirection={-1}
      onresize={(delta) => resizeWorkspace('palette', delta)}
    />
    <div class="dock palette-dock" style:width="{workspaceLayout.paletteWidth}px">
      <div class="panel-header">
        <nav class="panel-tabs" aria-label="Правая панель">
          {#each workspacePanels as panel (panel.id)}
            <button type="button" class:active={workspaceLayout.rightPanel === panel.id}
              aria-pressed={workspaceLayout.rightPanel === panel.id}
              aria-controls="workspace-panel-content"
              onclick={() => selectWorkspacePanel(panel.id)}>{panel.label}</button>
          {/each}
        </nav>
        <button
          type="button"
          class="hide-palette-button"
          aria-label="Скрыть правую панель"
          aria-controls="workspace-panel-content"
          aria-expanded="true"
          title="Скрыть правую панель"
          onclick={() => toggleWorkspaceDock('palette')}
        >
          <span class="panel-chevron" aria-hidden="true"></span>
        </button>
      </div>
      <div id="workspace-panel-content" class="panel-content" aria-label={workspacePanels.find((entry) => entry.id === workspaceLayout.rightPanel)?.label}>
        {#if workspaceLayout.rightPanel === 'colors' || workspaceLayout.rightPanel === 'palette'}
          <PalettePanel
            panelWidth={workspaceLayout.paletteWidth}
            palettes={allPalettes}
            customPaletteCount={customPalettes.length}
            {palette}
            {freeColor}
            {primary}
            {secondary}
            recent={visibleRecent}
            onpalette={selectPalette}
            onfreecolor={setFreeColor}
            onpick={setColor}
            onswap={swapColors}
            oncreatepalette={createProjectPalette}
            ondeletepalette={deleteProjectPalette}
          />
        {:else if workspaceLayout.rightPanel === 'layers' || workspaceLayout.rightPanel === 'properties'}
          {#if workspaceLayout.rightPanel === 'properties'}
            <section class="inspector-section" aria-label="Свойства холста">
              <h2>Свойства</h2>
              <p>Холст: {buffer.width} × {buffer.height} px</p>
              <p>Положение: {activeBoard.x}, {activeBoard.y}</p>
              <p>Активный слой: {getActiveLayer().name}</p>
              <p>Кадр: {activeFrameIndex + 1} / {animationFrames.length}</p>
              <ProjectMetadataPanel metadata={projectMetadata} onapply={updateProjectMetadata} />
            </section>
          {/if}
          <LayersPanel
            layers={activeLayers}
            groups={activeBoard.groups}
            {activeLayerId}
            hasSelection={selectionMask !== null}
            onselect={selectLayer}
            onadd={addLayer}
            onaddgroup={addLayerGroup}
            ongroupupdate={updateGroup}
            ongroupdelete={deleteGroup}
            onaddbackground={() => addSpecialLayer('background')}
            onaddreference={() => addSpecialLayer('reference')}
            onduplicate={duplicateLayer}
            ondelete={deleteLayer}
            onmove={moveLayer}
            onreorder={reorderLayers}
            onupdate={updateLayer}
            oncreatefromselection={getLayersFromSelection}
          />
        {:else if workspaceLayout.rightPanel === 'reference'}
          <ReferencesPanel
            {references}
            docked
            {selectedReferenceId}
            onimport={(file) => void importReference(file)}
            onselect={(id) => (selectedReferenceId = id)}
            onupdate={updateReference}
            onremove={removeReference}
            onclose={() => selectWorkspacePanel('palette')}
          />
        {:else if workspaceLayout.rightPanel === 'history'}
          <section class="inspector-section">
            <h2>История</h2>
            {#if historyEntries.length === 0}
              <p>Действий пока нет.</p>
            {:else}
              <ol class="history-list">
                {#each historyEntries as label, index (`${index}-${label}`)}
                  <li>{label}</li>
                {/each}
              </ol>
            {/if}
          </section>
        {:else if workspaceLayout.rightPanel === 'navigator' || workspaceLayout.rightPanel === 'preview'}
          <section class="inspector-section">
            <h2>{workspaceLayout.rightPanel === 'navigator' ? 'Navigator' : 'Preview'}</h2>
            <p>{buffer.width} × {buffer.height} px · масштаб {Math.round(view.zoom * 100)}%</p>
          </section>
        {:else if workspaceLayout.rightPanel === 'brush-settings'}
          <section class="inspector-section">
            <h2>Настройки кисти</h2>
            <label>Непрозрачность: {brushOpacity}%
              <input type="range" min="1" max="100" value={brushOpacity}
                oninput={(event) => setBrushOpacity(Number(event.currentTarget.value))} />
            </label>
            <div class="inspector-actions">
              <button type="button" aria-pressed={brushShape === 'square'} onclick={() => setBrushShape('square')}>Квадрат</button>
              <button type="button" aria-pressed={brushShape === 'circle'} onclick={() => setBrushShape('circle')}>Круг</button>
            </div>
          </section>
        {:else if workspaceLayout.rightPanel === 'brush-library'}
          <section class="inspector-section">
            <h2>Библиотека кистей</h2>
            <label>Кисть
              <select aria-label="Библиотека кистей" value={selectedBrushId} onchange={(event) => selectBrush(event.currentTarget.value)}>
                <option value="">Стандартная форма</option>
                {#each brushLibrary as brush (brush.id)}
                  <option value={brush.id}>{brush.name} · {brush.size}px</option>
                {/each}
              </select>
            </label>
            <label>Имя кисти
              <input bind:value={brushPanelName} maxlength="80" />
            </label>
            <label>Тип
              <select bind:value={brushPanelType}>
                <option value="pencil">Pencil</option><option value="square">Square</option>
                <option value="circle">Circle</option><option value="custom">Custom</option>
                <option value="pattern">Pattern</option><option value="stamp">Stamp</option>
                <option value="texture">Texture</option><option value="scatter">Scatter</option>
              </select>
            </label>
            <div class="inspector-actions">
              <button type="button" onclick={() => saveBrush(brushPanelName, brushPanelType)}>Сохранить текущую</button>
              <button type="button" disabled={!selectedBrushId} onclick={removeBrush}>Удалить</button>
            </div>
          </section>
        {:else if workspaceLayout.rightPanel === 'grid-settings'}
          <section class="inspector-section">
            <h2>Настройки сетки</h2>
            <label><input type="checkbox" checked={showGrid} onchange={(event) => (showGrid = event.currentTarget.checked)} /> Показывать сетку</label>
            <label>Режим
              <select value={gridMode} onchange={(event) => {
                const value = event.currentTarget.value;
                if (value === 'pixel' || value === 'square' || value === 'isometric') setGridMode(value);
              }}>
                <option value="pixel">Пиксельная</option><option value="square">Квадратная</option><option value="isometric">Изометрическая</option>
              </select>
            </label>
            <label>Шаг
              <select value={gridSpacing} onchange={(event) => {
                const value = Number(event.currentTarget.value);
                if (GRID_SPACINGS.some((spacing) => spacing === value)) setGridSpacing(value);
              }}>
                {#each GRID_SPACINGS as spacing (spacing)}<option value={spacing}>{spacing} px</option>{/each}
              </select>
            </label>
            <label><input type="checkbox" checked={snapToGrid} onchange={(event) => setSnapToGrid(event.currentTarget.checked)} /> Привязка</label>
            <label><input type="checkbox" checked={checkerboard} onchange={(event) => setCheckerboard(event.currentTarget.checked)} /> Шахматный фон</label>
          </section>
        {:else if workspaceLayout.rightPanel === 'export'}
          <section class="inspector-section">
            <h2>Экспорт</h2>
            <label>Формат
              <select value={exportFormat} onchange={(event) => {
                const value = event.currentTarget.value;
                if (isExportFormat(value)) exportFormat = value;
              }}>
                {#each EXPORT_FORMATS as format (format)}<option value={format}>{format.toUpperCase()}</option>{/each}
              </select>
            </label>
            <label>Масштаб
              <select value={exportScale} onchange={(event) => {
                const value = Number(event.currentTarget.value);
                if (isExportScale(value) && availableExportScales.includes(value)) exportScale = value;
              }}>
                {#each EXPORT_SCALES as scale (scale)}
                  <option value={scale} disabled={!availableExportScales.includes(scale)}>×{scale}</option>
                {/each}
              </select>
            </label>
            <p>Итоговый размер: {buffer.width * exportScale} × {buffer.height * exportScale}</p>
          </section>
        {/if}
        {#if pendingShortcutSequence.length > 0}
          <div class="shortcut-sequence-hint" role="status" aria-live="polite">
            {formatShortcutSequence(pendingShortcutSequence)} · ожидается продолжение
          </div>
        {/if}
      </div>
    </div>
    {/if}
  </div>

  {#if workspaceLayout.timelineVisible}
    <DockSplitter
      label="Изменить высоту Timeline"
      value={workspaceLayout.timelineHeight}
      min={90}
      max={360}
      valueDirection={-1}
      orientation="vertical"
      onresize={(delta) => resizeWorkspace('timeline', delta)}
    />
    <div class="timeline-dock" style:height="{workspaceLayout.timelineHeight}px">
      <TimelinePanel
        frames={animationFrames}
        activeIndex={activeFrameIndex}
        playing={animationPlaying}
        onselect={(index) => selectAnimationFrame(index)}
        onadd={addAnimationFrame}
        onduplicate={duplicateAnimationFrameAtCurrent}
        onremove={removeAnimationFrameAtCurrent}
        onduration={setAnimationFrameDuration}
        ontoggleplay={toggleAnimationPlayback}
      />
    </div>
  {/if}

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
  {#if fillInProgress}
    <div class="fill-overlay" role="status" aria-live="polite">
      <span class="fill-spinner" aria-hidden="true"></span>
      <span>Выполняется заливка. Редактор временно заблокирован.</span>
    </div>
  {/if}
</div>

{#if notice}
  <Toast message={notice.text} kind={notice.kind} onclose={dismissNotice} />
{/if}

{#if helpOpen}
  <HelpDialog
    tools={keyboardTools}
    {shortcuts}
    returnFocusTo={helpTrigger}
    onnotes={() => {
      helpOpen = false;
      showFeedbackNotes(helpTrigger);
    }}
    onclose={() => (helpOpen = false)}
  />
{/if}

{#if welcomeOpen}
  <WelcomeDialog
    returnFocusTo={welcomeTrigger}
    onclose={() => (welcomeOpen = false)}
    onacknowledge={acknowledgeWelcome}
  />
{/if}

{#if feedbackNotesOpen}
  <FeedbackNotesDialog
    returnFocusTo={feedbackNotesTrigger}
    onclose={() => (feedbackNotesOpen = false)}
    onnotify={notify}
  />
{/if}

{#if projectNotesOpen}
  <NotesDialog
    value={notesText}
    title={notesTitle}
    createdAt={notesCreatedAt}
    updatedAt={notesUpdatedAt}
    status={notesStatus}
    returnFocusTo={projectNotesTrigger}
    oninput={updateProjectNotes}
    ontitle={(value) => (notesTitle = value)}
    onimport={importNotesFile}
    onexport={exportProjectNotes}
    onclose={() => (projectNotesOpen = false)}
  />
{/if}

{#if settingsOpen}
<SettingsDialog
  {theme}
  initialTab={settingsTab}
  {canvasBackground}
  {workspaceBackground}
  {secondaryColorDrawing}
  {shortcuts}
  returnFocusTo={settingsTrigger}
  ontheme={setTheme}
  oncanvasbackground={setCanvasBackground}
  onworkspacebackground={setWorkspaceBackground}
  onsecondarycolordrawing={setSecondaryColorDrawing}
  onshortcuts={setShortcuts}
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
    grid-template-rows: auto auto auto auto minmax(0, 1fr) auto auto auto;
    height: 100%;
  }

  .body {
    display: flex;
    min-width: 0;
    min-height: 0;
  }

  .fill-overlay {
    position: fixed;
    z-index: 110;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: rgba(8, 10, 16, 0.62);
    color: var(--text);
    cursor: progress;
  }

  .fill-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: fill-spin 0.8s linear infinite;
  }

  .shortcut-sequence-hint {
    position: fixed;
    z-index: 100;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100vw - 24px);
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
    color: var(--text);
    box-shadow: 0 4px 16px #0005;
    font: 12px var(--mono);
  }

  @keyframes fill-spin {
    to { transform: rotate(360deg); }
  }

  .dock {
    flex: 0 0 auto;
    min-width: 0;
    height: 100%;
    overflow: hidden;
  }

  :global(.tool-dock:has(.options[open])) {
    position: relative;
    z-index: 40;
    overflow: visible;
  }

  /* Узкий экран: панель инструментов — полоса сверху, палитра — полоса снизу */
  @media (max-width: 859px) {
    .body {
      flex-direction: column;
    }

    .dock {
      width: auto !important;
      height: auto;
      max-height: 42vh;
    }

    .tool-dock {
      max-height: 36vh;
    }
  }

  .workspace {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .panel-header {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    min-width: 0;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }

  .timeline-dock {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .palette-dock {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .panel-tabs {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    gap: 2px;
    overflow-x: auto;
    padding: 4px;
    scrollbar-width: thin;
  }

  .panel-tabs button {
    min-height: 27px;
    padding: 3px 7px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-dim);
    font: inherit;
    font-size: 11px;
    white-space: nowrap;
    cursor: pointer;
  }

  .hide-palette-button,
  .show-palette-button {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 30px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text-dim);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .hide-palette-button {
    margin: 0 4px;
  }

  .hide-palette-button:hover,
  .show-palette-button:hover {
    border-color: var(--button-border-hover);
    background: var(--button-hover);
    color: var(--text);
  }

  .panel-chevron {
    width: 7px;
    height: 7px;
    border-top: 1.5px solid currentColor;
    border-right: 1.5px solid currentColor;
    transform: rotate(45deg);
  }

  .show-palette-button {
    position: absolute;
    z-index: 20;
    top: 50%;
    right: 0;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    box-shadow: 0 2px 8px #0004;
    transform: translateY(-50%);
  }

  .show-palette-button .panel-chevron {
    transform: rotate(-135deg);
  }

  .panel-tabs button.active {
    border-color: var(--border);
    background: var(--panel-2);
    color: var(--text);
  }

  .panel-content {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .inspector-section {
    display: grid;
    align-content: start;
    gap: 10px;
    padding: 12px;
    color: var(--text);
    font-size: 12px;
  }

  .inspector-section h2, .inspector-section p { margin: 0; }
  .inspector-section label { display: grid; gap: 4px; color: var(--text-dim); }
  .inspector-section input:not([type="checkbox"]):not([type="range"]),
  .inspector-section select,
  .inspector-section button {
    min-height: 28px;
    padding: 4px 7px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text);
    font: inherit;
  }
  .inspector-section button { cursor: pointer; }
  .inspector-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .history-list { display: grid; gap: 5px; margin: 0; padding-left: 20px; }
  .inspector-section :focus-visible, .panel-tabs :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .hide-palette-button:focus-visible,
  .show-palette-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
