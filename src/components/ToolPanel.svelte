<script lang="ts">
  import { hexToRgba, rgbaToHex } from '../core/color';
  import {
    type DrawingSettings,
    type Tool,
    type ToolId,
    parseCustomDitherPattern,
  } from '../core/tools';

  interface Props {
    panelWidth: number;
    tools: readonly Tool[];
    activeToolId: ToolId;
    settings: DrawingSettings;
    onselect: (id: ToolId) => void;
    onsettings: (settings: DrawingSettings) => void;
    onaddboard: () => void;
  }

  let {
    panelWidth,
    tools,
    activeToolId,
    settings,
    onselect,
    onsettings,
    onaddboard,
  }: Props = $props();

  const shapeToolIds: readonly ToolId[] = [
    'line', 'rect', 'filledRect', 'circle', 'filledCircle', 'ellipse',
    'filledEllipse', 'triangle', 'filledTriangle', 'polygon', 'filledPolygon',
  ];
  const shapeTools = $derived(tools.filter((tool) => shapeToolIds.includes(tool.id)));
  const activeShapeTool = $derived(shapeTools.find((tool) => tool.id === activeToolId));
  let shapeMenuOpen = $state(false);
  let shapeMenuContainer = $state<HTMLDivElement | null>(null);

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

  .panel:has(.options[open]) {
    overflow: visible;
  }

  .panel > * {
    flex-shrink: 0;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 6px;
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

  .tool:focus-visible {
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

    .rule {
      width: 1px;
      height: 28px;
    }

    .tip {
      display: none;
    }
  }

  .options {
    position: relative;
    z-index: 25;
  }

  .options[open] {
    z-index: 80;
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
