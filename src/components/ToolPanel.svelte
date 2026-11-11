<script lang="ts">
  import { untrack } from 'svelte';
  import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE, type Tool, type ToolId } from '../core/tools';

  interface Props {
    tools: readonly Tool[];
    activeToolId: ToolId;
    brushSize: number;
    onselect: (id: ToolId) => void;
    onbrush: (size: number) => void;
    onaddboard: () => void;
  }

  let { tools, activeToolId, brushSize, onselect, onbrush, onaddboard }: Props = $props();

  const brushSizes = Array.from({ length: MAX_BRUSH_SIZE - MIN_BRUSH_SIZE + 1 }, (_, i) => MIN_BRUSH_SIZE + i);
  let openBrushToolId = $state<ToolId | null>(null);
  let previousActiveToolId = untrack(() => activeToolId);

  $effect(() => {
    if (activeToolId === previousActiveToolId) return;
    previousActiveToolId = activeToolId;
    openBrushToolId = tools.find((tool) => tool.id === activeToolId)?.usesBrush ? activeToolId : null;
  });

  function selectTool(tool: Tool): void {
    const alreadySelected = tool.id === activeToolId;
    onselect(tool.id);
    if (!tool.usesBrush) {
      openBrushToolId = null;
      return;
    }
    openBrushToolId = alreadySelected && openBrushToolId === tool.id ? null : tool.id;
  }

  function closeBrushPanelOnOutsidePointer(event: PointerEvent): void {
    if (!(event.target instanceof Node) || !panelElement?.contains(event.target)) {
      openBrushToolId = null;
    }
  }

  function closeBrushPanelOnEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape' && openBrushToolId) {
      openBrushToolId = null;
    }
  }

  let panelElement: HTMLElement | undefined = $state();
</script>

<svelte:document onpointerdown={closeBrushPanelOnOutsidePointer} />
<svelte:window onkeydown={closeBrushPanelOnEscape} />

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
    {:else if id === 'rect'}
      <rect x="4.5" y="6.5" width="15" height="11" rx="1" />
    {/if}
  </svg>
{/snippet}

<aside class="panel" aria-label="Инструменты" bind:this={panelElement}>
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
      <div class="slot">
        <button
          type="button"
          class="tool"
          class:active={tool.id === activeToolId}
          aria-pressed={tool.id === activeToolId}
          aria-label="{tool.label} ({tool.hotkeyLabel})"
          aria-keyshortcuts={tool.hotkeyLabel}
          aria-expanded={tool.usesBrush ? openBrushToolId === tool.id : undefined}
          aria-controls={tool.usesBrush ? `brush-options-${tool.id}` : undefined}
          onclick={() => selectTool(tool)}
        >
          {@render icon(tool.id)}
        </button>
        {@render tip(tool.label, tool.hotkeyLabel, tool.hint)}
        {#if tool.usesBrush && openBrushToolId === tool.id}
          <div
            id="brush-options-{tool.id}"
            class="brush-popover"
            role="group"
            aria-label="Толщина инструмента «{tool.label}»"
          >
            <span class="brush-title">Толщина · {tool.label}</span>
            <div class="brush-options">
              {#each brushSizes as size (size)}
                <button
                  type="button"
                  class="size"
                  class:active={size === brushSize}
                  aria-pressed={size === brushSize}
                  aria-label="Толщина {size} px"
                  aria-keyshortcuts={String(size)}
                  onclick={() => onbrush(size)}
                >
                  <span class="dot" style:width="{size * 3 + 1}px" style:height="{size * 3 + 1}px"></span>
                  <span>{size}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</aside>

<style>
  .panel {
    position: relative;
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: 60px;
    padding: 12px 0;
    background: var(--panel);
    border-right: 1px solid var(--border);
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
    color: var(--accent-contrast);
  }

  .tool:focus-visible,
  .size:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  @media (hover: none) {
    .tip {
      display: none;
    }
  }

  @media (max-width: 859px) {
    .panel {
      flex-direction: row;
      justify-content: flex-start;
      width: auto;
      padding: 6px 12px;
      overflow-x: auto;
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

  .size {
    display: grid;
    place-items: center;
    grid-template-columns: 16px auto;
    gap: 6px;
    min-width: 46px;
    min-height: 34px;
    padding: 4px 7px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel-2);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .size:hover {
    border-color: #3b3f50;
  }

  .size.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .dot {
    display: block;
    justify-self: center;
    max-width: 14px;
    max-height: 14px;
    background: var(--text);
    border-radius: 1px;
  }

  .brush-popover {
    position: absolute;
    top: 50%;
    left: calc(100% + 9px);
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 190px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-raised);
    box-shadow: var(--shadow-md);
    transform: translateY(-50%);
  }

  .brush-title {
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }

  .brush-options {
    display: flex;
    gap: 5px;
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
    background: var(--panel-raised);
    box-shadow: var(--shadow-md);
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

  @media (max-width: 859px) {
    .brush-popover {
      top: calc(100% + 8px);
      left: 0;
      transform: none;
    }
  }

  @media (pointer: coarse) {
    .size {
      min-height: 40px;
    }
  }
</style>
