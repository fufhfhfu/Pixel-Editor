<script lang="ts">
  import { untrack } from 'svelte';
  import { trapFocus } from './focusTrap';
  import { saveDesktopBlob } from '../core/desktopFiles';
  import type { ThemePreference } from '../core/preferences';
  import {
    SHORTCUT_ACTIONS,
    findShortcutConflicts,
    formatShortcutSequence,
    MAX_SHORTCUT_SEQUENCE_LENGTH,
    parseShortcutScheme,
    serializeShortcutScheme,
    type ShortcutMap,
    type ShortcutSequence,
  } from '../core/hotkeys';

  interface Props {
    theme: ThemePreference;
    initialTab: 'general' | 'background' | 'hotkeys';
    canvasBackground: string;
    workspaceBackground: string;
    secondaryColorDrawing: boolean;
    shortcuts: ShortcutMap;
    returnFocusTo: HTMLElement | null;
    ontheme: (theme: ThemePreference) => void;
    oncanvasbackground: (color: string) => void;
    onworkspacebackground: (color: string) => void;
    onsecondarycolordrawing: (enabled: boolean) => void;
    onshortcuts: (shortcuts: ShortcutMap) => void;
    onclose: () => void;
  }

  let {
    theme,
    initialTab,
    canvasBackground,
    workspaceBackground,
    secondaryColorDrawing,
    shortcuts,
    returnFocusTo,
    ontheme,
    oncanvasbackground,
    onworkspacebackground,
    onsecondarycolordrawing,
    onshortcuts,
    onclose,
  }: Props = $props();
  let closeButton: HTMLButtonElement | undefined = $state();
  let activeTab = $state<'general' | 'background' | 'hotkeys'>(untrack(() => initialTab));
  let capturingAction = $state<string | null>(null);
  let sequenceMode = $state(false);
  let capturedSequence = $state<ShortcutSequence>([]);
  let message = $state('');
  let schemeInput: HTMLInputElement | undefined = $state();
  const conflicts = $derived(findShortcutConflicts(shortcuts));

  $effect(() => {
    closeButton?.focus();
  });

  function onKeydown(event: KeyboardEvent): void {
    if (capturingAction) {
      if (event.code === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        capturingAction = null;
        capturedSequence = [];
        message = 'Назначение отменено.';
        return;
      }
      if (/^(Alt|Shift|Control|Meta)(Left|Right)$/.test(event.code)) {
        if (SHORTCUT_ACTIONS.find((action) => action.id === capturingAction)?.temporary) {
          event.preventDefault();
          event.stopPropagation();
          assignShortcut(capturingAction, [{
            code: event.code,
            ctrl: false,
            shift: false,
            alt: false,
            meta: false,
          }]);
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const stroke = {
        code: event.code,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey,
      };
      if (!sequenceMode) {
        assignShortcut(capturingAction, [stroke]);
        return;
      }
      capturedSequence = [...capturedSequence, stroke];
      message = capturedSequence.length >= MAX_SHORTCUT_SEQUENCE_LENGTH
        ? 'Достигнута максимальная длина последовательности. Завершите назначение.'
        : `Нажмите следующую клавишу (${capturedSequence.length}/${MAX_SHORTCUT_SEQUENCE_LENGTH}); Escape отменяет назначение.`;
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
    }
  }

  function assignShortcut(actionId: string, sequence: ShortcutSequence): void {
    const updated = {
      ...shortcuts,
      [actionId]: [...(shortcuts[actionId] ?? []), sequence],
    };
    const nextConflicts = findShortcutConflicts(updated);
    if (nextConflicts.length) {
      const conflict = nextConflicts[0]!;
      message = `Сочетание ${formatShortcutSequence(conflict.sequence)} уже назначено или конфликтует с началом другого сочетания.`;
      capturingAction = null;
      capturedSequence = [];
      return;
    }
    capturingAction = null;
    capturedSequence = [];
    message = '';
    onshortcuts(updated);
  }

  function finishSequence(): void {
    if (!capturingAction || capturedSequence.length === 0) return;
    assignShortcut(capturingAction, capturedSequence);
  }

  function removeShortcut(actionId: string, index: number): void {
    const updated = {
      ...shortcuts,
      [actionId]: shortcuts[actionId]!.filter((_, bindingIndex) => bindingIndex !== index),
    };
    onshortcuts(updated);
    message = '';
  }

  async function exportScheme(): Promise<void> {
    const blob = new Blob([serializeShortcutScheme(shortcuts)], { type: 'application/json' });
    try {
      await saveDesktopBlob(blob, 'pixel-editor-hotkeys.json');
    } catch (error) {
      message = `Не удалось сохранить схему: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async function importScheme(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 64_000) throw new Error('Файл схемы горячих клавиш слишком большой.');
      const imported = parseShortcutScheme(await file.text());
      onshortcuts(imported);
      message = 'Схема горячих клавиш импортирована.';
      capturedSequence = [];
      capturingAction = null;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      input.value = '';
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
      <button
        type="button"
        role="tab"
        id="settings-hotkeys-tab"
        aria-selected={activeTab === 'hotkeys'}
        aria-controls="settings-hotkeys-panel"
        class:active={activeTab === 'hotkeys'}
        onclick={() => (activeTab = 'hotkeys')}
      >Клавиши</button>
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
    {:else if activeTab === 'background'}
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
        <fieldset>
          <legend>Дополнительный цвет</legend>
          <label>
            <input
              type="checkbox"
              aria-label="Рисовать дополнительным цветом через Shift+левую кнопку"
              checked={secondaryColorDrawing}
              onchange={(event) => onsecondarycolordrawing(event.currentTarget.checked)}
            />
            Рисовать дополнительным цветом через Shift+левую кнопку
          </label>
          <p>Правый клик по холсту открывает меню действий и не рисует.</p>
        </fieldset>
      </div>
    {:else}
      <div id="settings-hotkeys-panel" role="tabpanel" aria-labelledby="settings-hotkeys-tab" tabindex="0">
        <fieldset>
          <legend>Сочетания клавиш</legend>
          <p>Нажмите «Назначить», затем комбинацию. Сочетания используют физический код клавиши и работают независимо от раскладки.</p>
          <div class="scheme-actions">
            <button type="button" class="btn" onclick={exportScheme}>Экспортировать схему</button>
            <button type="button" class="btn" onclick={() => schemeInput?.click()}>Импортировать схему</button>
            <input
              bind:this={schemeInput}
              type="file"
              accept="application/json,.json"
              aria-label="Файл схемы горячих клавиш"
              onchange={importScheme}
              hidden
            />
          </div>
          {#each SHORTCUT_ACTIONS as action (action.id)}
            <div class="shortcut-row">
              <span>{action.label}</span>
              <div class="bindings">
                {#each shortcuts[action.id] ?? [] as shortcut, index (`${action.id}-${index}`)}
                  <span class="binding">
                    <kbd>{formatShortcutSequence(shortcut)}</kbd>
                    <button
                      type="button"
                      class="remove-binding"
                      aria-label={`Удалить сочетание ${formatShortcutSequence(shortcut)} для действия «${action.label}»`}
                      onclick={() => removeShortcut(action.id, index)}
                    >×</button>
                  </span>
                {/each}
                <button
                  type="button"
                  class="btn assign"
                  aria-label={`Назначить сочетание для действия «${action.label}»`}
                  onclick={() => {
                    capturingAction = action.id;
                    sequenceMode = false;
                    capturedSequence = [];
                    message = 'Нажмите клавишу или сочетание; Escape отменяет назначение.';
                  }}
                >{capturingAction === action.id && !sequenceMode ? 'Ожидание…' : 'Назначить'}</button>
                <button
                  type="button"
                  class="btn assign"
                  aria-label={`Назначить последовательность клавиш для действия «${action.label}»`}
                  disabled={Boolean(action.temporary)}
                  onclick={() => {
                    capturingAction = action.id;
                    sequenceMode = true;
                    capturedSequence = [];
                    message = `Нажмите до ${MAX_SHORTCUT_SEQUENCE_LENGTH} клавишных сочетаний, затем завершите назначение.`;
                  }}
                >{capturingAction === action.id && sequenceMode ? 'Ввод…' : 'Последовательность'}</button>
                {#if capturingAction === action.id && sequenceMode && capturedSequence.length > 0}
                  <span class="captured-sequence">{formatShortcutSequence(capturedSequence)}</span>
                  <button type="button" class="btn assign" onclick={finishSequence}>Завершить</button>
                {/if}
              </div>
            </div>
          {/each}
          {#if conflicts.length}
            <p class="error" role="alert">Обнаружены конфликты сочетаний. Исправьте их перед продолжением.</p>
          {/if}
          {#if message}
            <p class:success={!capturingAction && !conflicts.length && message.includes('импортирована')} class:error={conflicts.length > 0} role="status">{message}</p>
          {/if}
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
    width: min(720px, 100%);
    max-height: 100%;
    overflow-y: auto;
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

  #settings-hotkeys-panel fieldset {
    gap: 8px;
  }

  .shortcut-row {
    display: grid;
    grid-template-columns: minmax(150px, 1fr) minmax(200px, 1.4fr);
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }

  .bindings,
  .scheme-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .binding {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 4px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--panel-2);
  }

  kbd {
    font: 12px var(--mono);
  }

  .remove-binding {
    border: 0;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
  }

  .assign {
    padding: 4px 7px;
  }

  .error {
    color: var(--danger, #f66);
  }

  .success {
    color: var(--success, #6c6);
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

  @media (max-width: 520px) {
    .shortcut-row {
      grid-template-columns: 1fr;
      gap: 5px;
    }
  }
</style>
