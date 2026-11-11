<script lang="ts">
  import { GRID_SPACINGS, type CanvasSize, type GridMode } from '../core/preferences';
  import {
    DEFAULT_GRID_SIZE,
    GRID_PRESETS,
    MAX_GRID_SIZE,
    MIN_GRID_SIZE,
    isValidCanvasSize,
    isValidGridSize,
  } from '../core/state';

  interface Props {
    width: number;
    height: number;
    showGrid: boolean;
    gridMode: GridMode;
    gridSpacing: number;
    snapToGrid: boolean;
    checkerboard: boolean;
    tiledMode: boolean;
    tilemapMode: boolean;
    symmetryX: boolean;
    symmetryY: boolean;
    referencesOpen: boolean;
    includeReferencesInExport: boolean;
    hasVisibleReferences: boolean;
    customSizes: readonly CanvasSize[];
    undoShortcut: string;
    ontogglegrid: () => void;
    ongridmode: (mode: GridMode) => void;
    ongridspacing: (spacing: number) => void;
    onsnaptogrid: (enabled: boolean) => void;
    oncheckerboard: (enabled: boolean) => void;
    ontiledmode: (enabled: boolean) => void;
    ontilemapmode: (enabled: boolean) => void;
    onsymmetryx: (enabled: boolean) => void;
    onsymmetryy: (enabled: boolean) => void;
    ontogglereferences: () => void;
    onincludeReferencesInExport: (include: boolean) => void;
    onpreview: () => void;
    onfit: () => void;
    oncenter: () => void;
    onactualsize: () => void;
    onzoomin: () => void;
    onzoomout: () => void;
    onresize: (width: number, height: number) => void;
    onsavesize: () => void;
    onremovesize: () => void;
    onclear: () => void;
  }

  let {
    width,
    height,
    showGrid,
    gridMode,
    gridSpacing,
    snapToGrid,
    checkerboard,
    tiledMode,
    tilemapMode,
    symmetryX,
    symmetryY,
    referencesOpen,
    includeReferencesInExport,
    hasVisibleReferences,
    customSizes,
    undoShortcut,
    ontogglegrid,
    ongridmode,
    ongridspacing,
    onsnaptogrid,
    oncheckerboard,
    ontiledmode,
    ontilemapmode,
    onsymmetryx,
    onsymmetryy,
    ontogglereferences,
    onincludeReferencesInExport,
    onpreview,
    onfit,
    oncenter,
    onactualsize,
    onzoomin,
    onzoomout,
    onresize,
    onsavesize,
    onremovesize,
    onclear,
  }: Props = $props();

  let customW = $state<number | null>(DEFAULT_GRID_SIZE);
  let customH = $state<number | null>(DEFAULT_GRID_SIZE);
  let selectedSize = $state('');
  let presetSize = $state(`${DEFAULT_GRID_SIZE}x${DEFAULT_GRID_SIZE}`);

  // Поля «своего размера» показывают текущий размер сетки
  $effect(() => {
    customW = width;
    customH = height;
  });

  const customValid = $derived(
    customW !== null && customH !== null && isValidCanvasSize(customW, customH),
  );
  const customSizeError = $derived(
    customW !== null &&
      customH !== null &&
      isValidGridSize(customW) &&
      isValidGridSize(customH) &&
      !isValidCanvasSize(customW, customH),
  );
  const currentSizeIsSaved = $derived(customSizes.some((size) => size.width === width && size.height === height));

  $effect(() => {
    selectedSize = customSizes.some((size) => size.width === width && size.height === height)
      ? `${width}x${height}`
      : '';
    presetSize = `${width}x${height}`;
  });

  function applyCustom(): void {
    if (customW === null || customH === null) return;
    if (!isValidCanvasSize(customW, customH)) return;
    onresize(customW, customH);
  }

  function onCustomKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') applyCustom();
  }

  function selectCustomSize(e: Event & { currentTarget: HTMLSelectElement }): void {
    const [savedWidth, savedHeight] = e.currentTarget.value.split('x').map(Number);
    if (isValidCanvasSize(savedWidth, savedHeight)) onresize(savedWidth, savedHeight);
  }

  function selectPresetSize(e: Event & { currentTarget: HTMLSelectElement }): void {
    const [presetWidth, presetHeight] = e.currentTarget.value.split('x').map(Number);
    if (isValidCanvasSize(presetWidth, presetHeight)) onresize(presetWidth, presetHeight);
  }

  function selectGridMode(e: Event & { currentTarget: HTMLSelectElement }): void {
    const mode = e.currentTarget.value;
    if (mode === 'pixel' || mode === 'square' || mode === 'isometric') ongridmode(mode);
  }

  function selectGridSpacing(e: Event & { currentTarget: HTMLSelectElement }): void {
    const spacing = Number(e.currentTarget.value);
    if (GRID_SPACINGS.includes(spacing as (typeof GRID_SPACINGS)[number])) ongridspacing(spacing);
  }
</script>

<section class="toolbar" aria-label="Настройки холста">
  <div class="group">
    <label class="label" for="canvas-preset">Размер</label>
    <select id="canvas-preset" class="saved-sizes" aria-label="Системный размер холста" bind:value={presetSize} onchange={selectPresetSize}>
    {#each GRID_PRESETS as size (size)}
      <option value={`${size}x${size}`}>{size}×{size}</option>
    {/each}
    </select>
  </div>

  <div class="divider"></div>

  <div class="group">
    <span class="label">Свой</span>
    <input
      class="num"
      type="number"
      min={MIN_GRID_SIZE}
      max={MAX_GRID_SIZE}
      step="1"
      aria-label="Ширина"
      bind:value={customW}
      onkeydown={onCustomKeydown}
    />
    <span class="times">×</span>
    <input
      class="num"
      type="number"
      min={MIN_GRID_SIZE}
      max={MAX_GRID_SIZE}
      step="1"
      aria-label="Высота"
      bind:value={customH}
      onkeydown={onCustomKeydown}
    />
    <button type="button" class="btn" disabled={!customValid} onclick={applyCustom}>Применить</button>
    {#if customSizeError}
      <span class="size-error" role="status">Максимальная площадь холста — 4 194 304 пикселя.</span>
    {/if}
  </div>

  <div class="divider"></div>

  <div class="group">
    <label class="label" for="saved-canvas-sizes">Мои размеры</label>
    <select
      id="saved-canvas-sizes"
      class="saved-sizes"
      aria-label="Сохранённые размеры холста"
      bind:value={selectedSize}
      onchange={selectCustomSize}
    >
      <option value="">Выбрать</option>
      {#each customSizes as size (`${size.width}x${size.height}`)}
        <option value={`${size.width}x${size.height}`}>{size.width}×{size.height}</option>
      {/each}
    </select>
    <button
      type="button"
      class="btn"
      disabled={!customValid || currentSizeIsSaved}
      title="Сохранить текущий размер, чтобы использовать его позже"
      onclick={onsavesize}
    >Сохранить размер</button>
    <button
      type="button"
      class="btn"
      disabled={!selectedSize}
      title="Удалить выбранный пользовательский размер"
      onclick={onremovesize}
    >Удалить</button>
  </div>

  <div class="spacer"></div>

  <div class="group">
    <button
      type="button"
      class="btn"
      class:active={referencesOpen}
      aria-pressed={referencesOpen}
      title="Открыть менеджер референсов"
      onclick={ontogglereferences}
    >Референсы</button>
    <label class="check-setting" title="По умолчанию референсы не включаются в экспорт">
      <input
        type="checkbox"
        aria-label="Включать референсы в экспорт"
        checked={includeReferencesInExport}
        disabled={!hasVisibleReferences}
        onchange={(event) => onincludeReferencesInExport(event.currentTarget.checked)}
      />
      Экспортировать референсы
    </label>
    <button type="button" class="btn" title="Центрировать активный холст" onclick={oncenter}>Центр</button>
    <button type="button" class="btn icon" title="Уменьшить (−)" aria-label="Уменьшить" onclick={onzoomout}>−</button>
    <button type="button" class="btn icon" title="Увеличить (+)" aria-label="Увеличить" onclick={onzoomin}>+</button>
    <button type="button" class="btn" title="Показать активный холст в масштабе 100%" onclick={onactualsize}>100%</button>
    <button type="button" class="btn" class:active={tilemapMode} aria-pressed={tilemapMode}
      title="Открыть редактор Tilemap" onclick={() => ontilemapmode(!tilemapMode)}>Tilemap</button>
    <button type="button" class="btn" title="Вписать холст в окно (F)" onclick={onfit}>
      Вписать <span class="kbd">F</span>
    </button>
    <button
      type="button"
      class="btn"
      class:active={showGrid}
      aria-pressed={showGrid}
      title="Показать/скрыть сетку (G)"
      onclick={ontogglegrid}
    >
      Сетка <span class="kbd">G</span>
    </button>
    <label class="inline-setting">
      <span class="sr-only">Тип сетки</span>
      <select aria-label="Тип сетки" value={gridMode} onchange={selectGridMode}>
        <option value="pixel">Пиксельная</option>
        <option value="square">Квадратная</option>
        <option value="isometric">Изометрическая</option>
      </select>
    </label>
    <label class="inline-setting">
      <span class="sr-only">Шаг сетки</span>
      <select aria-label="Шаг сетки" value={gridSpacing} onchange={selectGridSpacing}>
        {#each GRID_SPACINGS as spacing}
          <option value={spacing}>{spacing} px</option>
        {/each}
      </select>
    </label>
    <details class="view-settings">
      <summary class="btn view-settings-tab" aria-label="Вид" title="Настройки отображения">Вид</summary>
      <div class="view-settings-panel" role="group" aria-label="Настройки отображения">
        <label class="check-setting" title="Привязка перемещаемых холстов к выбранному шагу сетки">
          <input type="checkbox" checked={snapToGrid} onchange={(event) => onsnaptogrid(event.currentTarget.checked)} />
          Привязка
        </label>
        <label class="check-setting" title="Шахматный фон для прозрачных пикселей">
          <input type="checkbox" checked={checkerboard} onchange={(event) => oncheckerboard(event.currentTarget.checked)} />
          Шахматный фон
        </label>
        <label class="check-setting" title="Повторять активный холст по горизонтали и вертикали">
          <input type="checkbox" checked={tiledMode} onchange={(event) => ontiledmode(event.currentTarget.checked)} />
          Повтор
        </label>
        <label class="check-setting" title="Показать вертикальную ось симметрии">
          <input type="checkbox" checked={symmetryX} onchange={(event) => onsymmetryx(event.currentTarget.checked)} />
          Симметрия X
        </label>
        <label class="check-setting" title="Показать горизонтальную ось симметрии">
          <input type="checkbox" checked={symmetryY} onchange={(event) => onsymmetryy(event.currentTarget.checked)} />
          Симметрия Y
        </label>
      </div>
    </details>
    <button type="button" class="btn" title="Открыть активный холст в отдельном окне предпросмотра" onclick={onpreview}>
      Окно предпросмотра
    </button>
    <button type="button" class="btn" title={`Очистить холст; действие можно отменить (${undoShortcut})`} onclick={onclear}>
      Очистить
    </button>
  </div>
</section>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    min-height: 48px;
    padding: 6px 14px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }

  .group {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .view-settings {
    position: relative;
    z-index: 30;
  }

  .view-settings-tab {
    display: flex;
    align-items: center;
    min-height: 30px;
    list-style: none;
  }

  .view-settings-tab::-webkit-details-marker {
    display: none;
  }

  .view-settings-panel {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    display: grid;
    gap: 10px;
    min-width: max-content;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .label {
    margin-right: 4px;
    color: var(--text-dim);
    font-size: 12px;
    letter-spacing: 0.02em;
  }

  .divider {
    width: 1px;
    height: 22px;
    background: var(--border);
  }

  .spacer {
    flex: 1;
  }

  .icon {
    justify-content: center;
    width: 34px;
    padding: 0;
    font-size: 16px;
  }

  @media (max-width: 1100px) {
    .toolbar > .spacer {
      display: none;
    }

    .toolbar > .group:last-child {
      flex: 1 1 100%;
      flex-wrap: wrap;
    }
  }

  .inline-setting select {
    min-height: 30px;
    padding: 0 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text);
    font: inherit;
  }

  .check-setting {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-dim);
    font-size: 12px;
    white-space: nowrap;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }

  @media (max-width: 720px) {
    .label,
    .divider,
    .spacer {
      display: none;
    }
  }

  .times {
    color: var(--text-dim);
  }

  .size-error {
    color: var(--danger, #e06c75);
    font-size: 11px;
  }

  .num {
    width: 64px;
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-family: var(--mono);
  }

  .saved-sizes {
    width: 106px;
    height: 30px;
    padding: 0 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }

  .num:focus {
    outline: 2px solid var(--accent);
    outline-offset: 0;
    border-color: var(--accent);
  }
</style>
