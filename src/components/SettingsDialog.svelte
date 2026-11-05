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
          <label>
            <input type="radio" name="theme" value="system" checked={theme === 'system'} onchange={() => ontheme('system')} />
            Системная
          </label>
          <label>
            <input type="radio" name="theme" value="dark" checked={theme === 'dark'} onchange={() => ontheme('dark')} />
            Тёмная
          </label>
          <label>
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
    background: rgba(5, 6, 10, 0.65);
    backdrop-filter: blur(2px);
  }

  .dialog {
    width: min(420px, 100%);
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
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
    padding: 8px 12px;
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
