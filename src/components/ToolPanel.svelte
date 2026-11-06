<script lang="ts">
  import { hexToRgba, rgbaToHex } from '../core/color';
  import {
    MAX_BRUSH_SIZE,
    MIN_BRUSH_SIZE,
    type BrushShape,
    type DrawingSettings,
    type BrushDefinition,
    type BrushType,
    type Tool,
    type ToolId,
    bresenham,
    parseCustomDitherPattern,
    parseBrushLibrary,
    resizeBrushDefinition,
  } from '../core/tools';
  import type { SelectionMode, SelectionOperation } from '../core/selection';
  import LayersPanel from './LayersPanel.svelte';
  import type { LayerGroup, LayerGroupUpdate, LayerUpdate, RasterLayer } from '../core/layers';

  export type SelectionAction =
    | 'select-all' | 'select-opaque' | 'invert' | 'deselect' | 'copy' | 'cut' | 'paste' | 'clear' | 'crop'
    | 'move-left' | 'move-right' | 'move-up' | 'move-down'
    | 'flip-horizontal' | 'flip-vertical' | 'rotate-left' | 'rotate-right' | 'scale-up' | 'scale-down';

  interface Props {
    panelWidth: number;
    tools: readonly Tool[];
    activeToolId: ToolId;
    brushSize: number;
    brushShape: BrushShape;
    brushOpacity: number;
    settings: DrawingSettings;
    brushes: readonly BrushDefinition[];
    selectedBrushId: string;
    selectionMode: SelectionMode | null;
    selectionOperation: SelectionOperation;
    selectionAvailable: boolean;
    clipboardAvailable: boolean;
    layers: readonly RasterLayer[];
    groups: readonly LayerGroup[];
    activeLayerId: string;
    hasSelection: boolean;
    showLayers?: boolean;
    onselect: (id: ToolId) => void;
    onbrush: (size: number) => void;
    onbrushshape: (shape: BrushShape) => void;
    onbrushopacity: (opacity: number) => void;
    onsettings: (settings: DrawingSettings) => void;
    onbrushsave: (name: string, type: BrushType) => void;
    onbrushselect: (id: string) => void;
    onbrushdelete: () => void;
    onbrushupdate: (brush: BrushDefinition) => void;
    onbrushimport: (brushes: readonly BrushDefinition[]) => void;
    onbrushexport: (brush: BrushDefinition) => string;
    onbrusherror: (message: string) => void;
    onaddboard: () => void;
    onselectionmode: (mode: SelectionMode | null) => void;
    onselectionoperation: (operation: SelectionOperation) => void;
    onselectionaction: (action: SelectionAction) => void;
    onlayerselect: (id: string) => void;
    onlayeradd: () => void;
    onaddgroup: () => void;
    ongroupupdate: (id: string, update: LayerGroupUpdate) => void;
    ongroupdelete: (id: string) => void;
    onaddbackground: () => void;
    onaddreference: () => void;
    onlayerduplicate: (id: string) => void;
    onlayerdelete: (id: string) => void;
    onlayermove: (id: string, direction: -1 | 1) => void;
    onlayerreorder: (sourceId: string, targetId: string) => void;
    onlayerupdate: (id: string, update: LayerUpdate) => void;
    oncreatefromselection: () => void;
  }

  let {
    panelWidth,
    tools,
    activeToolId,
    brushSize,
    brushShape,
    brushOpacity,
    settings,
    brushes,
    selectedBrushId,
    selectionMode,
    selectionOperation,
    selectionAvailable,
    clipboardAvailable,
    layers,
    groups,
    activeLayerId,
    hasSelection,
    showLayers = true,
    onselect,
    onbrush,
    onbrushshape,
    onbrushopacity,
    onsettings,
    onbrushsave,
    onbrushselect,
    onbrushdelete,
    onbrushupdate,
    onbrushimport,
    onbrushexport,
    onbrusherror,
    onaddboard,
    onselectionmode,
    onselectionoperation,
    onselectionaction,
    onlayerselect,
    onlayeradd,
    onaddgroup,
    ongroupupdate,
    ongroupdelete,
    onaddbackground,
    onaddreference,
    onlayerduplicate,
    onlayerdelete,
    onlayermove,
    onlayerreorder,
    onlayerupdate,
    oncreatefromselection,
  }: Props = $props();

  const brushEnabled = $derived(tools.find((t) => t.id === activeToolId)?.usesBrush ?? false);
  const selectedBrush = $derived(brushes.find((brush) => brush.id === selectedBrushId) ?? null);
  const shapeToolIds: readonly ToolId[] = [
    'line', 'rect', 'filledRect', 'circle', 'filledCircle', 'ellipse',
    'filledEllipse', 'triangle', 'filledTriangle', 'polygon', 'filledPolygon',
  ];
  const shapeTools = $derived(tools.filter((tool) => shapeToolIds.includes(tool.id)));
  const activeShapeTool = $derived(shapeTools.find((tool) => tool.id === activeToolId));
  let shapeMenuOpen = $state(false);
  let shapeMenuContainer = $state<HTMLDivElement | null>(null);
  let brushName = $state('');
  let brushType = $state<BrushType>('custom');
  let importInput: HTMLInputElement;
  let brushMaskCanvas = $state<HTMLCanvasElement | null>(null);
  let lastMaskCell: { x: number; y: number } | null = null;
  let focusedMaskCell = { x: 0, y: 0 };
  let maskPaintValue = 1;

  function renderBrushMask(brush: BrushDefinition): void {
    if (!brushMaskCanvas) return;
    const context = brushMaskCanvas.getContext('2d');
    if (!context) throw new Error('Не удалось создать контекст редактора маски кисти.');
    const cellSize = brushMaskCanvas.width / brush.size;
    context.imageSmoothingEnabled = false;
    context.fillStyle = '#363a48';
    context.fillRect(0, 0, brushMaskCanvas.width, brushMaskCanvas.height);
    for (let y = 0; y < brush.size; y++) {
      for (let x = 0; x < brush.size; x++) {
        if (!brush.mask[y * brush.size + x]) continue;
        context.fillStyle = '#b7a5ff';
        context.fillRect(Math.floor(x * cellSize), Math.floor(y * cellSize), Math.ceil(cellSize), Math.ceil(cellSize));
      }
    }
    if (brush.size <= 16) {
      context.strokeStyle = '#ffffff30';
      context.lineWidth = 1;
      for (let cell = 0; cell <= brush.size; cell++) {
        const position = Math.round(cell * cellSize) + 0.5;
        context.beginPath();
        context.moveTo(position, 0);
        context.lineTo(position, brushMaskCanvas.height);
        context.moveTo(0, position);
        context.lineTo(brushMaskCanvas.width, position);
        context.stroke();
      }
    }
    if (document.activeElement === brushMaskCanvas) {
      context.strokeStyle = '#ffffff';
      context.lineWidth = 2;
      context.strokeRect(
        focusedMaskCell.x * cellSize + 1,
        focusedMaskCell.y * cellSize + 1,
        cellSize - 2,
        cellSize - 2,
      );
    }
  }

  function updateMaskCell(brush: BrushDefinition, x: number, y: number): void {
    if (x < 0 || y < 0 || x >= brush.size || y >= brush.size) return;
    const mask = [...brush.mask];
    mask[y * brush.size + x] = maskPaintValue;
    onbrushupdate({ ...brush, mask });
  }

  function brushMaskPointerDown(event: PointerEvent): void {
    if (!selectedBrush || !brushMaskCanvas) return;
    event.preventDefault();
    brushMaskCanvas.setPointerCapture(event.pointerId);
    const bounds = brushMaskCanvas.getBoundingClientRect();
    const x = Math.min(selectedBrush.size - 1, Math.floor(((event.clientX - bounds.left) / bounds.width) * selectedBrush.size));
    const y = Math.min(selectedBrush.size - 1, Math.floor(((event.clientY - bounds.top) / bounds.height) * selectedBrush.size));
    maskPaintValue = event.button === 2 ? 0 : selectedBrush.mask[y * selectedBrush.size + x] ? 0 : 1;
    lastMaskCell = { x, y };
    focusedMaskCell = { x, y };
    updateMaskCell(selectedBrush, x, y);
  }

  function brushMaskKeyDown(event: KeyboardEvent): void {
    if (!selectedBrush) return;
    const directions: Record<string, readonly [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.code];
    if (direction) {
      event.preventDefault();
      focusedMaskCell = {
        x: Math.max(0, Math.min(selectedBrush.size - 1, focusedMaskCell.x + direction[0])),
        y: Math.max(0, Math.min(selectedBrush.size - 1, focusedMaskCell.y + direction[1])),
      };
      renderBrushMask(selectedBrush);
    } else if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      maskPaintValue = selectedBrush.mask[focusedMaskCell.y * selectedBrush.size + focusedMaskCell.x] ? 0 : 1;
      updateMaskCell(selectedBrush, focusedMaskCell.x, focusedMaskCell.y);
    }
  }

  function brushMaskPointerMove(event: PointerEvent): void {
    if (!selectedBrush || !brushMaskCanvas || !lastMaskCell || !brushMaskCanvas.hasPointerCapture(event.pointerId)) return;
    const bounds = brushMaskCanvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - bounds.left) / bounds.width) * selectedBrush.size);
    const y = Math.floor(((event.clientY - bounds.top) / bounds.height) * selectedBrush.size);
    const from = lastMaskCell;
    bresenham(from.x, from.y, x, y, (cellX, cellY) => updateMaskCell(selectedBrush, cellX, cellY));
    lastMaskCell = { x, y };
  }

  $effect(() => {
    const brush = selectedBrush;
    if (brush) renderBrushMask(brush);
  });

  async function importBrushFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      onbrushimport(parseBrushLibrary(await file.text()));
    } catch (error) {
      onbrusherror(`Не удалось импортировать кисть: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      input.value = '';
    }
  }

  function exportSelectedBrush(): void {
    if (!selectedBrush) return;
    const blob = new Blob([onbrushexport(selectedBrush)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedBrush.name.replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '') || 'brush'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function closeShapeMenuOnOutsidePointer(event: PointerEvent): void {
    if (shapeMenuOpen && shapeMenuContainer && event.target instanceof Node && !shapeMenuContainer.contains(event.target)) {
      shapeMenuOpen = false;
    }
  }

  function closeShapeMenuOnEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape' && shapeMenuOpen) {
      shapeMenuOpen = false;
      shapeMenuContainer?.querySelector<HTMLButtonElement>('.shape-folder')?.focus();
    }
  }
</script>

<svelte:window
  onpointerdown={closeShapeMenuOnOutsidePointer}
  onkeydown={closeShapeMenuOnEscape}
/>

{#snippet tip(title: string, key: string, hint?: string)}
  <span class="tip" role="tooltip">
    <span class="tip-title">{title}</span>
    <span class="kbd">{key}</span>
    {#if hint}<span class="tip-hint">{hint}</span>{/if}
  </span>
{/snippet}

{#snippet icon(id: ToolId)}
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#if id === 'pencil'}
      <path d="M4 20l1.2-4.2L16.5 4.5a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1L8.2 18.8z" />
      <path d="M14.5 6.5l3 3" />
    {:else if id === 'eraser'}
      <path d="M4.5 14.5l8-8a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L12.3 18.7H8.2z" />
      <path d="M9.5 11.5l4.5 4.5" />
      <path d="M13 20h7" />
    {:else if id === 'fill'}
      <path d="M5 11l6-6 7 7-6 6a2 2 0 0 1-2.8 0L5 13.8a2 2 0 0 1 0-2.8z" />
      <path d="M5 11h13" />
      <path d="M19.5 15c1 1.4 1.5 2.3 1.5 3a1.5 1.5 0 0 1-3 0c0-.7.5-1.6 1.5-3z" />
    {:else if id === 'picker'}
      <path d="M16 4a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3l-3 3-4-4z" />
      <path d="M12 7l5 5" />
      <path d="M13 10l-8 8v1.5h1.5l8-8" />
    {:else if id === 'line'}
      <path d="M5 19L19 5" />
      <circle cx="5" cy="19" r="1.4" />
      <circle cx="19" cy="5" r="1.4" />
    {:else if id === 'rect' || id === 'filledRect'}
      <rect x="4.5" y="6.5" width="15" height="11" rx="1" />
    {:else if id === 'circle' || id === 'filledCircle'}
      <circle cx="12" cy="12" r="7" />
    {:else if id === 'ellipse' || id === 'filledEllipse'}
      <ellipse cx="12" cy="12" rx="8" ry="5" />
    {:else if id === 'triangle' || id === 'filledTriangle'}
      <path d="M12 4 21 20H3z" />
    {:else if id === 'polygon' || id === 'filledPolygon'}
      <path d="m12 3 8 6-3 10H7L4 9z" />
    {:else if id === 'gradient'}
      <path d="M4 5h16M4 9h16M4 13h16M4 17h16M4 21h16" />
    {:else if id === 'dither'}
      <path d="M4 4h3v3H4zM10 4h3v3h-3zM16 4h3v3h-3zM7 10h3v3H7zM13 10h3v3h-3zM4 16h3v3H4zM10 16h3v3h-3zM16 16h3v3h-3z" />
    {/if}
  </svg>
{/snippet}

<aside class="panel" aria-label="Инструменты" style:--dock-width="{panelWidth}px">
  <button
    type="button"
    class="add-board"
    aria-label="Добавить холст"
    title="Добавить холст на рабочее поле"
    onclick={onaddboard}
  ><span aria-hidden="true">+</span></button>

  <div class="rule"></div>

  <div class="section">
    {#each tools as tool (tool.id)}
      {#if tool.id === 'line'}
        <div class="shape-menu" class:open={shapeMenuOpen} bind:this={shapeMenuContainer}>
          <button
            type="button"
            class="tool shape-folder"
            class:active={activeShapeTool !== undefined}
            aria-label="Фигуры"
            aria-expanded={shapeMenuOpen}
            title="Фигуры"
            onclick={() => (shapeMenuOpen = !shapeMenuOpen)}
          >
            {@render icon(activeShapeTool?.id ?? 'rect')}
            <svg class="shape-chevron" viewBox="0 0 8 12" aria-hidden="true">
              <path d="m2 1 5 5-5 5" />
            </svg>
          </button>
          {#if shapeMenuOpen}
            <div class="shape-menu-panel" role="group" aria-label="Фигуры">
              {#each shapeTools as shape (shape.id)}
                <div class="slot">
                  <button
                    type="button"
                    class="tool"
                    class:active={shape.id === activeToolId}
                    aria-pressed={shape.id === activeToolId}
                    aria-label="{shape.label} ({shape.hotkeyLabel})"
                    aria-keyshortcuts={shape.hotkeyLabel}
                    onclick={() => {
                      onselect(shape.id);
                      shapeMenuOpen = false;
                    }}
                  >
                    {@render icon(shape.id)}
                  </button>
                  {@render tip(shape.label, shape.hotkeyLabel, shape.hint)}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {:else if !shapeToolIds.includes(tool.id)}
        <div class="slot">
          <button
            type="button"
            class="tool"
            class:active={tool.id === activeToolId}
            aria-pressed={tool.id === activeToolId}
            aria-label="{tool.label} ({tool.hotkeyLabel})"
            aria-keyshortcuts={tool.hotkeyLabel}
            onclick={() => onselect(tool.id)}
          >
            {@render icon(tool.id)}
          </button>
          {@render tip(tool.label, tool.hotkeyLabel, tool.hint)}
        </div>
      {/if}
    {/each}
  </div>

  <div class="rule"></div>

  <div class="section brush" class:dim={!brushEnabled}>
    <label class="control-label" for="brush-size">Размер {brushSize}px</label>
    <input
      id="brush-size"
      class="slider"
      type="range"
      min={MIN_BRUSH_SIZE}
      max={MAX_BRUSH_SIZE}
      step="1"
      value={brushSize}
      aria-label="Размер кисти"
      aria-valuetext="{brushSize} пикселей"
      disabled={!brushEnabled}
      oninput={(event) => onbrush(Number(event.currentTarget.value))}
    />
    <div class="brush-shapes" role="group" aria-label="Форма кисти">
      <button
        type="button"
        class="shape"
        class:active={brushShape === 'square'}
        aria-label="Квадратная кисть"
        aria-pressed={brushShape === 'square'}
        disabled={!brushEnabled}
        onclick={() => onbrushshape('square')}
      ><span class="square-tip"></span></button>
      <button
        type="button"
        class="shape"
        class:active={brushShape === 'circle'}
        aria-label="Круглая кисть"
        aria-pressed={brushShape === 'circle'}
        disabled={!brushEnabled}
        onclick={() => onbrushshape('circle')}
      ><span class="circle-tip"></span></button>
    </div>
    <label class="control-label" for="brush-opacity">Непрозрачность {brushOpacity}%</label>
    <input
      id="brush-opacity"
      class="slider"
      type="range"
      min="0"
      max="100"
      step="1"
      value={brushOpacity}
      aria-label="Непрозрачность кисти"
      aria-valuetext="{brushOpacity}%"
      disabled={!brushEnabled}
      oninput={(event) => onbrushopacity(Number(event.currentTarget.value))}
    />
  </div>
  <details class="options">
    <summary aria-label="Параметры инструмента" title="Параметры инструмента">⚙</summary>
    <div class="options-panel">
      {#if activeToolId === 'pencil'}
        <label class="check">
          <input
            type="checkbox"
            checked={settings.pixelPerfect}
            onchange={(event) => onsettings({ ...settings, pixelPerfect: event.currentTarget.checked })}
          />
          Pixel Perfect
        </label>
      {/if}
      {#if activeToolId === 'line'}
        <label>Фиксированный угол
          <select
            aria-label="Фиксированный угол линии"
            value={settings.lineAngleSnap}
            onchange={(event) => onsettings({ ...settings, lineAngleSnap: Number(event.currentTarget.value) as DrawingSettings['lineAngleSnap'] })}
          >
            <option value="0">Свободно</option><option value="15">15°</option>
            <option value="30">30°</option><option value="45">45°</option><option value="90">90°</option>
          </select>
        </label>
      {/if}
      {#if activeToolId === 'fill'}
        <label>Область
          <select
            aria-label="Режим заливки"
            value={settings.fillContiguous ? 'contiguous' : 'global'}
            onchange={(event) => onsettings({ ...settings, fillContiguous: event.currentTarget.value === 'contiguous' })}
          >
            <option value="contiguous">Связная</option><option value="global">Все совпадения</option>
          </select>
        </label>
        <label>Допуск {settings.fillTolerance}
          <input type="range" min="0" max="255" value={settings.fillTolerance}
            aria-label="Допуск заливки"
            oninput={(event) => onsettings({ ...settings, fillTolerance: Number(event.currentTarget.value) })} />
        </label>
        <label>Связность
          <select aria-label="Связность заливки" value={settings.fillConnectivity}
            onchange={(event) => onsettings({ ...settings, fillConnectivity: Number(event.currentTarget.value) as 4 | 8 })}>
            <option value="4">4 пикселя</option><option value="8">8 пикселей</option>
          </select>
        </label>
        <label class="check">
          <input type="checkbox" checked={settings.fillProtectAlpha}
            onchange={(event) => onsettings({ ...settings, fillProtectAlpha: event.currentTarget.checked })} />
          Защита альфа-канала
        </label>
        <label class="check">
          <input type="checkbox" checked={settings.sampleMerged}
            onchange={(event) => onsettings({ ...settings, sampleMerged: event.currentTarget.checked })} />
          Выбирать цвет по видимым слоям
        </label>
      {/if}
      {#if activeToolId === 'picker'}
        <label>Размер выборки
          <select aria-label="Радиус пипетки" value={settings.pickerRadius}
            onchange={(event) => onsettings({ ...settings, pickerRadius: Number(event.currentTarget.value) as DrawingSettings['pickerRadius'] })}>
            <option value="1">1 × 1 px</option><option value="3">3 × 3 px</option>
            <option value="5">5 × 5 px</option><option value="7">7 × 7 px</option>
          </select>
        </label>
        <label class="check">
          <input type="checkbox" checked={settings.sampleMerged}
            onchange={(event) => onsettings({ ...settings, sampleMerged: event.currentTarget.checked })} />
          Выбирать цвет по видимым слоям
        </label>
        <span class="note">Сэмплируется активный холст.</span>
      {/if}
      {#if activeToolId === 'polygon' || activeToolId === 'filledPolygon'}
        <label>Вершины {settings.polygonSides}
          <input type="range" min="3" max="12" value={settings.polygonSides}
            aria-label="Количество вершин многоугольника"
            oninput={(event) => onsettings({ ...settings, polygonSides: Number(event.currentTarget.value) })} />
        </label>
      {/if}
      {#if activeToolId === 'gradient'}
        <label>Тип
          <select aria-label="Тип градиента" value={settings.gradientKind}
            onchange={(event) => onsettings({ ...settings, gradientKind: event.currentTarget.value as DrawingSettings['gradientKind'] })}>
            <option value="linear">Линейный</option><option value="radial">Радиальный</option>
          </select>
        </label>
        <label class="check">
          <input type="checkbox" checked={settings.gradientDither}
            onchange={(event) => onsettings({ ...settings, gradientDither: event.currentTarget.checked })} />
          Дизеринг градиента
        </label>
        <label class="check">
          <input type="checkbox" checked={settings.gradientTransparency}
            onchange={(event) => onsettings({ ...settings, gradientTransparency: event.currentTarget.checked })} />
          Переход в прозрачность
        </label>
        <label class="check">
          <input type="checkbox" checked={settings.gradientMidpointEnabled}
            onchange={(event) => onsettings({ ...settings, gradientMidpointEnabled: event.currentTarget.checked })} />
          Средняя точка
        </label>
        {#if settings.gradientMidpointEnabled}
          <label>Цвет средней точки
            <input type="color" aria-label="Цвет средней точки градиента" value={rgbaToHex(settings.gradientMidpoint)}
              oninput={(event) => {
                const color = hexToRgba(event.currentTarget.value);
                if (color) onsettings({ ...settings, gradientMidpoint: color });
              }} />
          </label>
          <label>Позиция {settings.gradientMidpointPosition}%
            <input type="range" min="10" max="90" value={settings.gradientMidpointPosition}
              aria-label="Позиция средней точки градиента"
              oninput={(event) => onsettings({ ...settings, gradientMidpointPosition: Number(event.currentTarget.value) })} />
          </label>
        {/if}
        <span class="note">От основного цвета к дополнительному.</span>
      {/if}
      {#if activeToolId === 'dither'}
        <label>Паттерн
          <select aria-label="Паттерн дизеринга" value={settings.ditherPattern}
            onchange={(event) => onsettings({ ...settings, ditherPattern: event.currentTarget.value as DrawingSettings['ditherPattern'] })}>
            <option value="checkerboard">Шахматный</option><option value="bayer2">Bayer 2×2</option>
            <option value="bayer4">Bayer 4×4</option><option value="bayer8">Bayer 8×8</option>
            <option value="diagonal">Диагональный</option><option value="custom">Пользовательский</option>
          </select>
        </label>
        <label>Плотность {Math.round(settings.ditherDensity * 100)}%
          <input type="range" min="0" max="100" value={settings.ditherDensity * 100}
            aria-label="Плотность дизеринга"
            oninput={(event) => onsettings({ ...settings, ditherDensity: Number(event.currentTarget.value) / 100 })} />
        </label>
        <label>Масштаб {settings.ditherScale}
          <input type="range" min="1" max="8" value={settings.ditherScale}
            aria-label="Масштаб дизеринга"
            oninput={(event) => onsettings({ ...settings, ditherScale: Number(event.currentTarget.value) })} />
        </label>
        <label>Угол
          <select aria-label="Угол дизеринга" value={settings.ditherAngle}
            onchange={(event) => onsettings({ ...settings, ditherAngle: Number(event.currentTarget.value) as DrawingSettings['ditherAngle'] })}>
            <option value="0">0°</option><option value="45">45°</option>
            <option value="90">90°</option><option value="135">135°</option>
          </select>
        </label>
        {#if settings.ditherPattern === 'custom'}
          <label>Своя маска (строки через /)
            <input aria-label="Маска пользовательского дизеринга" value={settings.ditherCustomPattern}
              oninput={(event) => {
                const input = event.currentTarget;
                try {
                  parseCustomDitherPattern(input.value);
                  input.setCustomValidity('');
                  onsettings({ ...settings, ditherCustomPattern: input.value });
                } catch (error) {
                  input.setCustomValidity(error instanceof Error ? error.message : String(error));
                }
              }} />
          </label>
        {/if}
      {/if}
    </div>
  </details>
  {#if showLayers}
  <LayersPanel
    {layers}
    {groups}
    {activeLayerId}
    {hasSelection}
    onselect={onlayerselect}
    onadd={onlayeradd}
    {onaddgroup}
    {ongroupupdate}
    {ongroupdelete}
    {onaddbackground}
    {onaddreference}
    onduplicate={onlayerduplicate}
    ondelete={onlayerdelete}
    onmove={onlayermove}
    onreorder={onlayerreorder}
    onupdate={onlayerupdate}
    oncreatefromselection={oncreatefromselection}
  />
  {/if}
  <details class="brush-library">
    <summary>Выделение</summary>
    <div class="options-panel">
      <div class="selection-modes" role="group" aria-label="Инструмент выделения">
        <button type="button" class:active={selectionMode === 'rect'} aria-pressed={selectionMode === 'rect'}
          onclick={() => onselectionmode(selectionMode === 'rect' ? null : 'rect')}>Прямоугольное</button>
        <button type="button" class:active={selectionMode === 'ellipse'} aria-pressed={selectionMode === 'ellipse'}
          onclick={() => onselectionmode(selectionMode === 'ellipse' ? null : 'ellipse')}>Эллиптическое</button>
        <button type="button" class:active={selectionMode === 'lasso'} aria-pressed={selectionMode === 'lasso'}
          onclick={() => onselectionmode(selectionMode === 'lasso' ? null : 'lasso')}>Лассо</button>
        <button type="button" class:active={selectionMode === 'polygon'} aria-pressed={selectionMode === 'polygon'}
          onclick={() => onselectionmode(selectionMode === 'polygon' ? null : 'polygon')}>Многоугольное лассо</button>
        <button type="button" class:active={selectionMode === 'wand'} aria-pressed={selectionMode === 'wand'}
          onclick={() => onselectionmode(selectionMode === 'wand' ? null : 'wand')}>Волшебная палочка</button>
        <button type="button" class:active={selectionMode === 'color'} aria-pressed={selectionMode === 'color'}
          onclick={() => onselectionmode(selectionMode === 'color' ? null : 'color')}>Выбрать цвет</button>
      </div>
      <label>Комбинирование
        <select aria-label="Операция выделения" value={selectionOperation}
          onchange={(event) => onselectionoperation(event.currentTarget.value as SelectionOperation)}>
          <option value="replace">Заменить</option><option value="add">Добавить</option>
          <option value="subtract">Вычесть</option><option value="intersect">Пересечь</option>
        </select>
      </label>
      <label class="check">
        <input type="checkbox" checked={settings.sampleMerged}
          onchange={(event) => onsettings({ ...settings, sampleMerged: event.currentTarget.checked })} />
        Выделять и копировать по видимым слоям
      </label>
      <div class="selection-actions">
        <button type="button" onclick={() => onselectionaction('select-all')}>Выбрать всё</button>
        <button type="button" onclick={() => onselectionaction('select-opaque')}>Непрозрачные пиксели</button>
        <button type="button" disabled={!selectionAvailable} onclick={() => onselectionaction('invert')}>Инвертировать</button>
        <button type="button" disabled={!selectionAvailable} onclick={() => onselectionaction('deselect')}>Снять</button>
        <button type="button" disabled={!selectionAvailable} onclick={() => onselectionaction('copy')}>Копировать</button>
        <button type="button" disabled={!selectionAvailable} onclick={() => onselectionaction('cut')}>Вырезать</button>
        <button type="button" disabled={!clipboardAvailable} onclick={() => onselectionaction('paste')}>Вставить по центру</button>
        <button type="button" disabled={!selectionAvailable} onclick={() => onselectionaction('clear')}>Очистить пиксели</button>
        <button type="button" disabled={!selectionAvailable} onclick={() => onselectionaction('crop')}>Обрезать холст по выделению</button>
      </div>
      <span class="note">Прямоугольник, эллипс и лассо задаются перетаскиванием. Для многоугольного лассо ставьте точки и завершайте Enter или двойным щелчком. Палочка выбирает связную область.</span>
      <div class="selection-actions">
        <button type="button" disabled={!selectionAvailable} onclick={() => onselectionaction('move-left')}>← 1 px</button>
        <button type="button" disabled={!selectionAvailable} onclick={() => onselectionaction('move-right')}>→ 1 px</button>
        <button type="button" disabled={!selectionAvailable} onclick={() => onselectionaction('move-up')}>↑ 1 px</button>
        <button type="button" disabled={!selectionAvailable} onclick={() => onselectionaction('move-down')}>↓ 1 px</button>
        <button type="button" disabled={!selectionAvailable} onclick={() => onselectionaction('flip-horizontal')}>Отразить ↔</button>
        <button type="button" disabled={!selectionAvailable} onclick={() => onselectionaction('flip-vertical')}>Отразить ↕</button>
        <button type="button" disabled={!selectionAvailable} onclick={() => onselectionaction('rotate-left')}>Повернуть −90°</button>
        <button type="button" disabled={!selectionAvailable} onclick={() => onselectionaction('rotate-right')}>Повернуть +90°</button>
        <button type="button" disabled={!selectionAvailable} onclick={() => onselectionaction('scale-up')}>Масштаб ×2</button>
        <button type="button" disabled={!selectionAvailable} onclick={() => onselectionaction('scale-down')}>Масштаб ÷2</button>
      </div>
    </div>
  </details>
  <details class="brush-library">
    <summary>Кисти</summary>
    <div class="options-panel">
      <label>Моя кисть
        <select aria-label="Библиотека кистей" value={selectedBrushId} onchange={(event) => onbrushselect(event.currentTarget.value)}>
          <option value="">Стандартная форма</option>
          {#each brushes as brush (brush.id)}
            <option value={brush.id}>{brush.name} · {brush.type} · {brush.size}px</option>
          {/each}
        </select>
      </label>
      <label>Имя
        <input aria-label="Имя кисти" bind:value={brushName} maxlength="80" />
      </label>
      <label>Тип
        <select aria-label="Тип кисти" bind:value={brushType}>
          <option value="pencil">Pencil Brush</option>
          <option value="square">Square Brush</option>
          <option value="circle">Circle Brush</option>
          <option value="custom">Custom Brush</option>
          <option value="pattern">Pattern Brush</option>
          <option value="stamp">Stamp Brush</option>
          <option value="texture">Texture Brush</option>
          <option value="scatter">Scatter Brush</option>
        </select>
      </label>
      <button type="button" class="library-button" onclick={() => onbrushsave(brushName, brushType)}>Сохранить текущую кисть</button>
      <input bind:this={importInput} class="file-input" type="file" accept=".json,application/json" onchange={importBrushFile} />
      <button type="button" class="library-button" onclick={() => importInput.click()}>Импортировать кисть</button>
      <div class="library-actions">
        <button type="button" class="library-button" disabled={!selectedBrush} onclick={exportSelectedBrush}>Экспорт</button>
        <button type="button" class="library-button" disabled={!selectedBrush} onclick={onbrushdelete}>Удалить</button>
      </div>
      {#if selectedBrush}
        <span>Маска: {selectedBrush.mask.reduce((count, pixel) => count + pixel, 0)}/{selectedBrush.mask.length} пикселей</span>
        <canvas
          bind:this={brushMaskCanvas}
          class="brush-mask-editor"
          width="128"
          height="128"
          role="button"
          aria-roledescription="Редактор пиксельной маски"
          tabindex="0"
          aria-label="Редактор маски кисти: ЛКМ переключает пиксель, ПКМ стирает"
          onpointerdown={brushMaskPointerDown}
          onpointermove={brushMaskPointerMove}
          onpointerup={() => (lastMaskCell = null)}
          onpointercancel={() => (lastMaskCell = null)}
          onkeydown={brushMaskKeyDown}
          oncontextmenu={(event) => event.preventDefault()}
        ></canvas>
        <span class="note">Стрелки перемещают курсор; Enter/Пробел переключает пиксель.</span>
        <label>Размер {selectedBrush.size}px
          <input type="range" min="1" max="64" value={selectedBrush.size} aria-label="Размер пользовательской кисти"
            oninput={(event) => onbrushupdate(resizeBrushDefinition(selectedBrush!, Number(event.currentTarget.value)))} />
        </label>
        <label>Угол {selectedBrush.angle}°
          <input type="range" min="-180" max="180" value={selectedBrush.angle} aria-label="Угол пользовательской кисти"
            oninput={(event) => onbrushupdate({ ...selectedBrush!, angle: Number(event.currentTarget.value) })} />
        </label>
        <label>Интервал {selectedBrush.spacing}
          <input type="range" min="1" max="16" value={selectedBrush.spacing} aria-label="Интервал отпечатков кисти"
            oninput={(event) => onbrushupdate({ ...selectedBrush!, spacing: Number(event.currentTarget.value) })} />
        </label>
        <label>Плотность {Math.round(selectedBrush.density * 100)}%
          <input type="range" min="0" max="100" value={selectedBrush.density * 100} aria-label="Плотность кисти"
            oninput={(event) => onbrushupdate({ ...selectedBrush!, density: Number(event.currentTarget.value) / 100 })} />
        </label>
        <label>Разброс {selectedBrush.scatter}px
          <input type="range" min="0" max="64" value={selectedBrush.scatter} aria-label="Разброс кисти"
            oninput={(event) => onbrushupdate({ ...selectedBrush!, scatter: Number(event.currentTarget.value) })} />
        </label>
        <label class="check">
          <input type="checkbox" checked={selectedBrush.randomRotation}
            onchange={(event) => onbrushupdate({ ...selectedBrush!, randomRotation: event.currentTarget.checked })} />
          Случайный поворот
        </label>
        <label class="check">
          <input type="checkbox" checked={selectedBrush.randomSize}
            onchange={(event) => onbrushupdate({ ...selectedBrush!, randomSize: event.currentTarget.checked })} />
          Случайный размер
        </label>
        <label class="check">
          <input type="checkbox" checked={selectedBrush.pressure}
            onchange={(event) => onbrushupdate({ ...selectedBrush!, pressure: event.currentTarget.checked })} />
          Давление пера
        </label>
      {/if}
    </div>
  </details>
</aside>

<style>
  .panel {
    position: relative;
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: var(--dock-width, 60px);
    height: 100%;
    min-height: 0;
    padding: 12px 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    background: var(--panel);
    border-right: 1px solid var(--border);
  }

  .panel > * {
    flex-shrink: 0;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .brush {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    width: 52px;
    transition: opacity 0.12s;
  }

  .brush.dim {
    opacity: 0.4;
  }

  .rule {
    width: 28px;
    height: 1px;
    background: var(--border);
  }

  .slot {
    position: relative;
    display: flex;
  }

  .shape-menu {
    position: relative;
    z-index: 1;
  }

  .shape-menu.open {
    z-index: 70;
  }

  .shape-folder {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }

  .shape-chevron {
    width: 7px;
    height: 11px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .shape-menu-panel {
    position: absolute;
    top: 0;
    left: calc(100% + 6px);
    display: grid;
    grid-template-columns: repeat(5, 40px);
    gap: 4px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .tool {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }

  .add-board {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 40px;
    min-height: 36px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .add-board > span:first-child {
    color: var(--accent);
    font-size: 20px;
    line-height: 1;
  }

  .tool:hover {
    background: var(--panel-2);
    color: var(--text);
  }

  .tool.active {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: #fff;
  }

  .tool:focus-visible,
  .shape:focus-visible,
  .slider:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  @media (hover: none) {
    .tip {
      display: none;
    }

    .shape-menu-panel {
      top: calc(100% + 6px);
      left: 0;
    }
  }

  @media (max-width: 859px) {
    .panel {
      flex-direction: row;
      justify-content: flex-start;
      width: auto;
      height: auto;
      padding: 6px 12px;
      overflow-x: auto;
      overflow-y: hidden;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    .section {
      flex-direction: row;
    }

    .brush {
      flex-direction: row;
      width: auto;
      gap: 7px;
    }

    .rule {
      width: 1px;
      height: 28px;
    }

    .tip {
      display: none;
    }
  }

  @media (pointer: coarse) {
    .shape {
      width: 32px;
      height: 32px;
    }
  }

  .shape {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--panel-2);
    cursor: pointer;
  }

  .shape:hover {
    border-color: #3b3f50;
  }

  .shape.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .square-tip,
  .circle-tip {
    display: block;
    width: 10px;
    height: 10px;
    background: var(--text);
    border-radius: 1px;
  }

  .control-label {
    color: var(--text-dim);
    font-size: 10px;
    white-space: nowrap;
  }

  .slider {
    width: 46px;
    margin: 0;
    accent-color: var(--accent);
  }

  @media (max-width: 859px) {
    .slider {
      width: 88px;
    }
  }

  .shape:disabled,
  .slider:disabled {
    cursor: not-allowed;
  }

  .circle-tip {
    border-radius: 50%;
  }

  .options {
    position: relative;
    z-index: 25;
  }

  .options > summary {
    display: grid;
    place-items: center;
    width: 36px;
    height: 30px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text);
    cursor: pointer;
    list-style: none;
  }

  .brush-library > summary {
    display: grid;
    place-items: center;
    min-width: 40px;
    min-height: 30px;
    padding: 0 5px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text);
    cursor: pointer;
    font-size: 11px;
    list-style: none;
  }

  .brush-library > summary::-webkit-details-marker {
    display: none;
  }

  .brush-library[open] .options-panel {
    top: 0;
  }

  .file-input {
    display: none;
  }

  .library-button {
    min-height: 30px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .library-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .library-actions {
    display: flex;
    gap: 6px;
  }

  .selection-modes,
  .selection-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 5px;
  }

  .selection-modes button,
  .selection-actions button {
    min-width: 0;
    min-height: 30px;
    padding: 4px 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .selection-modes button.active {
    border-color: var(--accent);
    color: var(--accent);
  }

  .selection-actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .brush-mask-editor {
    width: 128px;
    height: 128px;
    align-self: center;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: crosshair;
    touch-action: none;
  }

  .brush-mask-editor:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .options > summary::-webkit-details-marker {
    display: none;
  }

  .options-panel {
    position: absolute;
    top: 0;
    left: calc(100% + 8px);
    display: grid;
    gap: 10px;
    width: 230px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .options-panel label {
    display: grid;
    gap: 4px;
    color: var(--text-dim);
    font-size: 12px;
  }

  .options-panel select {
    min-height: 30px;
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--text);
  }

  .options-panel input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }

  .options-panel .check {
    display: flex;
    align-items: center;
    color: var(--text);
  }

  .note {
    color: var(--text-dim);
    font-size: 11px;
  }

  @media (max-width: 859px) {
    .options-panel {
      top: calc(100% + 6px);
      left: 0;
    }
  }

  .tip {
    position: absolute;
    left: calc(100% + 12px);
    top: 50%;
    z-index: 50;
    display: grid;
    grid-template-columns: auto auto;
    align-items: center;
    gap: 3px 10px;
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: #232634;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transform: translateY(-50%);
    transition: opacity 0.1s;
  }

  .slot:hover .tip,
  .slot:focus-within .tip {
    opacity: 1;
    transition-delay: 0.35s;
  }

  .tip-title {
    font-weight: 600;
  }

  .tip-hint {
    grid-column: 1 / -1;
    color: var(--text-dim);
    font-size: 12px;
  }
</style>
