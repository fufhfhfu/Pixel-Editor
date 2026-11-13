<script lang="ts">
  import { tick } from 'svelte';
  import { trapFocus } from './focusTrap';
  import type { EditorMenuGroup } from './EditorMenuBar.svelte';

  interface Props {
    groups: readonly EditorMenuGroup[];
    canSearch: boolean;
    onsearchchange: (open: boolean) => void;
    onselect: (command: string) => void;
  }

  let { groups, canSearch, onsearchchange, onselect }: Props = $props();
  let open = $state(false);
  let query = $state('');
  let activeIndex = $state(0);
  let returnFocusTo = $state<HTMLElement | null>(null);
  let input: HTMLInputElement | undefined = $state();

  const commands = $derived(groups.flatMap((group) => group.items.map((item) => ({
    ...item,
    group: group.label,
  }))));
  const results = $derived.by(() => {
    const search = query.trim().toLocaleLowerCase();
    return commands.filter((item) =>
      !item.disabled && (!search || `${item.label} ${item.group}`.toLocaleLowerCase().includes(search)),
    );
  });

  function isTypingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable);
  }

  function setOpen(next: boolean): void {
    if (next) {
      if (!canSearch || open) return;
      returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      query = '';
      activeIndex = 0;
      open = true;
      onsearchchange(true);
      void tick().then(() => input?.focus());
      return;
    }

    if (!open) return;
    open = false;
    onsearchchange(false);
  }

  function selectResult(command: string): void {
    open = false;
    onsearchchange(false);
    onselect(command);
  }

  function onInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % results.length;
    } else if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + results.length) % results.length;
    } else if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault();
      selectResult(results[activeIndex].command);
    }
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (open) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }

    if (
      canSearch &&
      event.code === 'KeyP' &&
      event.shiftKey &&
      (event.ctrlKey || event.metaKey) &&
      !isTypingTarget(event.target)
    ) {
      event.preventDefault();
      setOpen(true);
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<button type="button" class="menu-trigger search-trigger" aria-label="Поиск команд"
  disabled={!canSearch} onclick={() => setOpen(true)}>
  Поиск команд <kbd>Ctrl+Shift+P</kbd>
</button>

{#if open}
  <div class="search-backdrop" role="presentation" onmousedown={(event) => {
    if (event.target === event.currentTarget) setOpen(false);
  }}>
    <div class="search-dialog" role="dialog" aria-modal="true" aria-labelledby="command-search-title" tabindex="-1"
      use:trapFocus={returnFocusTo}>
      <header class="search-header">
        <h2 id="command-search-title">Поиск команд</h2>
        <button type="button" class="close-button" aria-label="Закрыть поиск команд"
          onclick={() => setOpen(false)}>Закрыть</button>
      </header>
      <input
        bind:this={input}
        class="search-input"
        type="search"
        aria-label="Поиск команд"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls="command-search-results"
        aria-activedescendant={results.length > 0 ? `command-result-${activeIndex}` : undefined}
        placeholder="Введите название команды или раздела"
        value={query}
        oninput={(event) => {
          query = event.currentTarget.value;
          activeIndex = 0;
        }}
        onkeydown={onInputKeydown}
      />
      <div class="search-results" id="command-search-results" role="listbox" aria-label="Результаты команд">
        {#each results as item, index (`${item.group}-${item.command}`)}
          <button type="button" role="option" id={`command-result-${index}`} aria-selected={activeIndex === index}
            onpointermove={() => (activeIndex = index)}
            onmousedown={(event) => event.preventDefault()}
            onclick={() => selectResult(item.command)}>
            <span>{item.label}</span>
            <small>{item.group}</small>
          </button>
        {:else}
          <p class="search-empty" role="status">Команды не найдены.</p>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
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
  .menu-trigger:hover:not(:disabled) { background: var(--panel-2); }
  .menu-trigger:disabled { color: var(--text-dim); cursor: default; }
  .search-trigger { white-space: nowrap; }
  .search-trigger kbd { margin-left: 5px; color: var(--text-dim); font: inherit; font-size: 10px; }
  .search-backdrop {
    position: fixed;
    inset: 0;
    z-index: 140;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: min(15vh, 120px) 16px 16px;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(6px);
  }
  .search-dialog {
    display: flex;
    flex-direction: column;
    width: min(560px, 100%);
    max-height: min(560px, calc(100dvh - 32px));
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
    box-shadow: var(--shadow-md);
  }
  .search-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; }
  .search-header h2 { margin: 0; font-size: 14px; font-weight: 600; }
  .close-button {
    padding: 5px 8px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .close-button:hover { background: var(--panel-2); }
  .search-input {
    margin: 0 12px 10px;
    padding: 11px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  .search-input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .search-results { overflow: auto; padding: 0 8px 8px; }
  .search-results button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: 36px;
    padding: 6px 9px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .search-results button[aria-selected="true"], .search-results button:hover { background: var(--panel-2); }
  .search-results small { color: var(--text-dim); font-size: 11px; }
  .search-empty { margin: 0; padding: 14px 10px; color: var(--text-dim); }
</style>
