<script lang="ts">
  import type { CanvasSize } from '../core/preferences';
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
    customSizes: readonly CanvasSize[];
    ontogglegrid: () => void;
    onfit: () => void;
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
    customSizes,
    ontogglegrid,
    onfit,
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
    <button type="button" class="btn icon" title="Уменьшить (−)" aria-label="Уменьшить" onclick={onzoomout}>−</button>
    <button type="button" class="btn icon" title="Увеличить (+)" aria-label="Увеличить" onclick={onzoomin}>+</button>
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
    <button type="button" class="btn" title="Очистить холст; действие можно отменить (Ctrl+Z)" onclick={onclear}>
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
