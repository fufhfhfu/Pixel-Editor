<script lang="ts">
  import { untrack } from 'svelte';
  import { trapFocus } from './focusTrap';
  import type { ThemePreference } from '../core/preferences';

  interface Props {
    theme: ThemePreference;
    initialTab: 'general' | 'background';
    canvasBackground: string;
    workspaceBackground: string;
    returnFocusTo: HTMLElement | null;
    ontheme: (theme: ThemePreference) => void;
    oncanvasbackground: (color: string) => void;
    onworkspacebackground: (color: string) => void;
    onclose: () => void;
  }

  let {
    theme,
    initialTab,
    canvasBackground,
    workspaceBackground,
    returnFocusTo,
    ontheme,
    oncanvasbackground,
    onworkspacebackground,
    onclose,
  }: Props = $props();
  let closeButton: HTMLButtonElement | undefined = $state();
  let activeTab = $state<'general' | 'background'>(untrack(() => initialTab));

  $effect(() => {
    closeButton?.focus();
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
    }
  }

  function onBackdropMousedown(event: MouseEvent): void {
    if (event.target === event.currentTarget) onclose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="backdrop" role="presentation" onmousedown={onBackdropMousedown}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" use:trapFocus={returnFocusTo}>
    <header>
      <h2 id="settings-title">Настройки</h2>
      <button type="button" class="btn" bind:this={closeButton} onclick={onclose}>Закрыть</button>
    </header>

    <div class="tabs" role="tablist" aria-label="Разделы настроек">
      <button
        type="button"
        role="tab"
        id="settings-general-tab"
        aria-selected={activeTab === 'general'}
        aria-controls="settings-general-panel"
        class:active={activeTab === 'general'}
        onclick={() => (activeTab = 'general')}
      >Общие</button>
      <button
        type="button"
        role="tab"
        id="settings-background-tab"
        aria-selected={activeTab === 'background'}
        aria-controls="settings-background-panel"
        class:active={activeTab === 'background'}
        onclick={() => (activeTab = 'background')}
      >Фон</button>
    </div>

    {#if activeTab === 'general'}
      <div id="settings-general-panel" role="tabpanel" aria-labelledby="settings-general-tab" tabindex="0">
        <fieldset>
          <legend>Тема оформления</legend>
          <label class="theme-option" class:chosen={theme === 'system'}>
            <input type="radio" name="theme" value="system" checked={theme === 'system'} onchange={() => ontheme('system')} />
            Системная
          </label>
          <label class="theme-option" class:chosen={theme === 'dark'}>
            <input type="radio" name="theme" value="dark" checked={theme === 'dark'} onchange={() => ontheme('dark')} />
            Тёмная
          </label>
          <label class="theme-option" class:chosen={theme === 'light'}>
            <input type="radio" name="theme" value="light" checked={theme === 'light'} onchange={() => ontheme('light')} />
            Светлая
          </label>
        </fieldset>
      </div>
    {:else}
      <div id="settings-background-panel" role="tabpanel" aria-labelledby="settings-background-tab" tabindex="0">
        <fieldset>
          <legend>Цвета рабочей области</legend>
          <label class="color-setting">
            <span>Фон холста (прозрачные пиксели)</span>
            <input
              type="color"
              value={canvasBackground}
              aria-label="Фон холста"
              oninput={(event) => oncanvasbackground(event.currentTarget.value)}
            />
          </label>
          <label class="color-setting">
            <span>Остальное пространство</span>
            <input
              type="color"
              value={workspaceBackground}
              aria-label="Фон рабочего пространства"
              oninput={(event) => onworkspacebackground(event.currentTarget.value)}
            />
          </label>
          <p>Цвет холста виден под прозрачными пикселями и используется при экспорте JPEG. Второй цвет применяется вокруг холста.</p>
        </fieldset>
      </div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(8px);
  }

  .dialog {
    width: min(420px, 100%);
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
    box-shadow: var(--shadow-md), 0 0 0 1px color-mix(in srgb, var(--border) 60%, transparent);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 20px;
  }

  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  fieldset {
    display: grid;
    gap: 12px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 18px;
    border-bottom: 1px solid var(--border);
  }

  .tabs button {
    min-height: 36px;
    padding: 8px 12px;
    border-radius: 7px 7px 0 0;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--text-dim);
    font: inherit;
    cursor: pointer;
  }

  .tabs button.active {
    border-bottom-color: var(--accent);
    color: var(--text);
  }

  .tabs button:hover:not(.active) {
    background: var(--button-hover);
    color: var(--text);
  }

  .theme-option {
    min-height: 42px;
    padding: 9px 11px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    transition: background 0.16s ease, border-color 0.16s ease;
  }

  .theme-option:hover {
    border-color: var(--button-border-hover);
    background: var(--button-hover);
  }

  .theme-option.chosen {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .color-setting {
    justify-content: space-between;
    gap: 16px;
  }

  .color-setting input {
    width: 44px;
    height: 32px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    cursor: pointer;
  }

  p {
    margin: 4px 0 0;
    color: var(--text-dim);
    line-height: 1.5;
  }

  legend {
    margin-bottom: 12px;
    color: var(--text-dim);
  }

  label {
    display: flex;
    align-items: center;
    gap: 9px;
    cursor: pointer;
  }

  input {
    accent-color: var(--accent);
  }
</style>
