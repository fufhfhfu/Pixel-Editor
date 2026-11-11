<script lang="ts">
  import { hexToRgba, rgbaToCss, rgbaToHex } from '../core/color';
  import { colorsEqual, type ColorSlot, type Palette } from '../core/palette';
  import type { RGBA } from '../core/state';

  interface Props {
    palettes: readonly Palette[];
    palette: Palette;
    freeColor: boolean;
    primary: RGBA;
    secondary: RGBA;
    recent: readonly RGBA[];
    onpalette: (id: string) => void;
    onfreecolor: (enabled: boolean) => void;
    onpick: (slot: ColorSlot, color: RGBA) => void;
    onswap: () => void;
  }

  let { palettes, palette, freeColor, primary, secondary, recent, onpalette, onfreecolor, onpick, onswap }: Props =
    $props();

  function onPaletteChange(e: Event & { currentTarget: HTMLSelectElement }): void {
    onpalette(e.currentTarget.value);
  }

  // ЛКМ — основной цвет, Shift+ЛКМ и ПКМ — дополнительный
  function onSwatchClick(e: MouseEvent, color: RGBA): void {
    onpick(e.shiftKey ? 'secondary' : 'primary', color);
  }

  function onSwatchContextMenu(e: MouseEvent, color: RGBA): void {
    e.preventDefault();
    onpick('secondary', color);
  }

  function onFreeInput(slot: ColorSlot, e: Event & { currentTarget: HTMLInputElement }): void {
    const next = hexToRgba(e.currentTarget.value);
    if (next) onpick(slot, next);
  }
</script>

{#snippet swatch(color: RGBA)}
  <button
    type="button"
    class="swatch"
    class:is-primary={colorsEqual(color, primary)}
    class:is-secondary={colorsEqual(color, secondary)}
    style:background={rgbaToCss(color)}
    title="{rgbaToHex(color)} — ЛКМ: основной, ПКМ: дополнительный"
    aria-label={rgbaToHex(color)}
    onclick={(e) => onSwatchClick(e, color)}
    oncontextmenu={(e) => onSwatchContextMenu(e, color)}
  ></button>
{/snippet}

<aside class="panel" aria-label="Палитра">
  <section class="block">
    <div class="current">
      <div class="big secondary" style:background={rgbaToCss(secondary)} title="Дополнительный цвет (ПКМ)">
        <input
          type="color"
          class="picker"
          disabled={!freeColor}
          value={rgbaToHex(secondary)}
          aria-label="Дополнительный цвет"
          oninput={(e) => onFreeInput('secondary', e)}
        />
      </div>
      <div class="big primary" style:background={rgbaToCss(primary)} title="Основной цвет (ЛКМ)">
        <input
          type="color"
          class="picker"
          disabled={!freeColor}
          value={rgbaToHex(primary)}
          aria-label="Основной цвет"
          oninput={(e) => onFreeInput('primary', e)}
        />
      </div>
      <button type="button" class="swap" title="Поменять цвета местами (X)" aria-label="Поменять цвета местами" onclick={onswap}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M7 4L3 8l4 4" />
          <path d="M3 8h14" />
          <path d="M17 20l4-4-4-4" />
          <path d="M21 16H7" />
        </svg>
      </button>
    </div>

    <dl class="readout">
      <div>
        <dt>Основной</dt>
        <dd>{rgbaToHex(primary)}</dd>
      </div>
      <div>
        <dt>Дополнительный</dt>
        <dd>{rgbaToHex(secondary)}</dd>
      </div>
    </dl>
  </section>

  <section class="block">
    <h2>Палитра</h2>
    <select class="select" aria-label="Пресет палитры" onchange={onPaletteChange}>
      {#each palettes as p (p.id)}
        <option value={p.id} selected={p.id === palette.id}>{p.name} · {p.colors.length}</option>
      {/each}
    </select>

    {#if palette.groups}
      <div class="palette-groups">
        {#each palette.groups as group (group.name)}
          <section class="palette-group" aria-label={group.name}>
            <h3>{group.name}</h3>
            <div class="swatches">
              {#each group.colors as color, i (`${group.name}-${i}`)}
                {@render swatch(color)}
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {:else}
      <div class="swatches">
        {#each palette.colors as color, i (i)}
          {@render swatch(color)}
        {/each}
      </div>
    {/if}
  </section>

  {#if recent.length > 0}
    <section class="block">
      <h2>Недавние</h2>
      <div class="swatches">
        {#each recent as color, i (i)}
          {@render swatch(color)}
        {/each}
      </div>
    </section>
  {/if}

  <section class="block free">
    <button
      type="button"
      class="switch"
      role="switch"
      aria-checked={freeColor}
      class:on={freeColor}
      onclick={() => onfreecolor(!freeColor)}
    >
      <span class="track"><span class="thumb"></span></span>
      <span class="switch-label">Свободный цвет</span>
    </button>
    <p class="empty">
      {freeColor
        ? 'Любой цвет: нажмите на большой квадрат выше, чтобы выбрать.'
        : 'Рисовать можно только цветами выбранной палитры.'}
    </p>
  </section>
</aside>

<style>
  .panel {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 18px;
    width: 236px;
    padding: 14px;
    overflow-y: auto;
    background: var(--panel);
    border-left: 1px solid var(--border);
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  h2 {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 500;
  }

  .current {
    position: relative;
    height: 68px;
  }

  .big {
    position: absolute;
    width: 44px;
    height: 44px;
    border: 2px solid #fff;
    border-radius: 8px;
    box-shadow: 0 0 0 1px var(--bg);
  }

  .big.primary {
    left: 0;
    top: 0;
    z-index: 2;
  }

  .big.secondary {
    left: 26px;
    top: 22px;
    z-index: 1;
    border-color: #8a90a2;
  }

  .picker {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    opacity: 0;
    cursor: pointer;
  }

  .picker:disabled {
    pointer-events: none;
  }

  .swap {
    position: absolute;
    right: 0;
    top: 0;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text-dim);
    cursor: pointer;
  }

  .swap:hover {
    color: var(--text);
    border-color: #3b3f50;
  }

  .swap:focus-visible,
  .swatch:focus-visible,
  .switch:focus-visible,
  .select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .readout {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
  }

  .readout div {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
  }

  .readout dt {
    color: var(--text-dim);
  }

  .readout dd {
    margin: 0;
    font-family: var(--mono);
  }

  .select {
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(22px, 1fr));
    gap: 6px;
    padding: 3px;
  }

  .palette-groups {
    display: grid;
    gap: 8px;
  }

  .palette-group {
    display: grid;
    gap: 2px;
  }

  .palette-group h3 {
    margin: 0;
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  .swatch {
    aspect-ratio: 1;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 4px;
    cursor: pointer;
  }

  .swatch.is-primary {
    box-shadow:
      0 0 0 1px var(--panel),
      0 0 0 3px #fff;
  }

  .swatch.is-secondary {
    box-shadow:
      0 0 0 1px var(--panel),
      0 0 0 3px var(--accent);
  }

  .swatch.is-primary.is-secondary {
    box-shadow:
      0 0 0 1px #fff,
      0 0 0 3px var(--accent);
  }

  .empty {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.5;
  }

  @media (max-width: 1099px) and (min-width: 860px) {
    .panel {
      width: 208px;
      padding: 12px;
    }
  }

  @media (max-width: 859px) {
    .panel {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: flex-start;
      width: auto;
      max-height: 42vh;
      gap: 14px 24px;
      padding: 10px 14px;
      border-left: 0;
      border-top: 1px solid var(--border);
    }

    .block {
      flex: 1 1 200px;
      min-width: 180px;
    }

    .free {
      margin-top: 0;
      padding-top: 0;
      border-top: 0;
    }
  }

  @media (pointer: coarse) {
    .swatches {
      grid-template-columns: repeat(auto-fill, minmax(30px, 1fr));
    }
  }

  .free {
    margin-top: auto;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }

  .switch {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .track {
    position: relative;
    width: 34px;
    height: 20px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    transition: background 0.12s, border-color 0.12s;
  }

  .thumb {
    position: absolute;
    left: 2px;
    top: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--text-dim);
    transition: transform 0.12s, background 0.12s;
  }

  .switch.on .track {
    background: var(--accent-soft);
    border-color: var(--accent);
  }

  .switch.on .thumb {
    transform: translateX(14px);
    background: #fff;
  }
</style>
