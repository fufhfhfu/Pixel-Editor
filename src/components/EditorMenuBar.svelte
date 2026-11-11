<script lang="ts">
  import { tick } from 'svelte';

  export interface EditorMenuItem {
    label: string;
    command: string;
    disabled?: boolean;
    separatorBefore?: boolean;
  }

  export interface EditorMenuGroup {
    label: string;
    items: readonly EditorMenuItem[];
  }

  interface Props {
    groups: readonly EditorMenuGroup[];
    oncommand: (command: string) => void;
    onopen: (file: File) => void;
  }

  let { groups, oncommand, onopen }: Props = $props();
  let openGroup = $state<string | null>(null);
  let root: HTMLElement;
  let fileInput: HTMLInputElement;

  function closeMenu(restoreFocus = false): void {
    const previous = openGroup;
    openGroup = null;
    if (restoreFocus && previous) {
      Array.from(root.querySelectorAll<HTMLButtonElement>('[data-menu]'))
        .find((button) => button.dataset.menu === previous)?.focus();
    }
  }

  async function openAndFocus(group: string, last = false): Promise<void> {
    openGroup = group;
    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const items = root.querySelectorAll<HTMLButtonElement>('.menu-popup button:not(:disabled)');
    (last ? items.item(items.length - 1) : items.item(0))?.focus();
  }

  function onTriggerKeydown(event: KeyboardEvent, group: string): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    void openAndFocus(group, event.key === 'ArrowUp');
  }

  function onDocumentPointerDown(event: PointerEvent): void {
    if (event.target instanceof Node && !root.contains(event.target)) closeMenu();
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && openGroup) {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (openGroup && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const items = Array.from(root.querySelectorAll<HTMLButtonElement>('.menu-popup button:not(:disabled)'));
      if (items.length === 0) return;
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : currentIndex < 0
            ? (event.key === 'ArrowDown' ? 0 : items.length - 1)
            : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      event.preventDefault();
      items[nextIndex]?.focus();
    }
  }

  function selectCommand(command: string): void {
    if (command === 'open') fileInput.click();
    else oncommand(command);
    closeMenu();
  }

  function onFileChange(event: Event & { currentTarget: HTMLInputElement }): void {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (file) onopen(file);
  }
</script>

<svelte:document onpointerdown={onDocumentPointerDown} />
<svelte:window onkeydown={onWindowKeydown} />

<nav class="menu-bar" aria-label="Главное меню" bind:this={root}>
  {#each groups as group (group.label)}
    <div class="menu">
      <button type="button" class="menu-trigger" aria-haspopup="menu"
        aria-expanded={openGroup === group.label} data-menu={group.label}
        onkeydown={(event) => onTriggerKeydown(event, group.label)}
        onclick={() => (openGroup = openGroup === group.label ? null : group.label)}>
        {group.label}
      </button>
      {#if openGroup === group.label}
        <div class="menu-popup" role="menu" aria-label={group.label}>
          {#each group.items as item (`${group.label}-${item.command}`)}
            {#if item.separatorBefore}<div class="separator" role="separator"></div>{/if}
            <button type="button" role="menuitem" tabindex="-1" disabled={item.disabled}
              onclick={() => selectCommand(item.command)}>{item.label}</button>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
  <input class="hidden" type="file" accept=".json,.png,.jpg,.jpeg,.webp,.bmp,application/json,image/png,image/jpeg,image/webp,image/bmp"
    tabindex="-1" aria-hidden="true" bind:this={fileInput} onchange={onFileChange} />
</nav>

<style>
  .menu-bar {
    position: relative;
    z-index: 120;
    display: flex;
    align-items: center;
    min-height: 34px;
    padding: 2px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }

  .menu { position: relative; }
  .menu-trigger {
    min-height: 28px;
    padding: 4px 9px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .menu-trigger:hover, .menu-trigger[aria-expanded="true"] { background: var(--panel-2); }
  .menu-popup {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    display: grid;
    gap: 2px;
    min-width: 190px;
    padding: 5px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.32);
  }
  .menu-popup button {
    min-height: 30px;
    padding: 5px 9px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .menu-popup button:hover:not(:disabled) { background: var(--panel-2); }
  .menu-popup button:disabled { color: var(--text-dim); cursor: default; }
  .separator { height: 1px; margin: 3px 4px; background: var(--border); }
  .hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  @media (max-width: 600px) {
    .menu-bar { overflow-x: auto; }
    .menu-trigger { padding-inline: 7px; }
  }
</style>
