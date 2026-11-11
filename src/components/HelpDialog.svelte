<script lang="ts">
  import type { Tool } from '../core/tools';
  import { formatShortcutSequence, type ShortcutMap } from '../core/hotkeys';
  import { trapFocus } from './focusTrap';

  interface Props {
    tools: readonly Tool[];
    shortcuts: ShortcutMap;
    returnFocusTo: HTMLElement | null;
    onclose: () => void;
  }

  let { tools, shortcuts, returnFocusTo, onclose }: Props = $props();

  let closeButton: HTMLButtonElement | undefined = $state();

  $effect(() => {
    closeButton?.focus();
  });

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }

  function onBackdropMousedown(e: MouseEvent): void {
    if (e.target === e.currentTarget) onclose();
  }

  interface Row {
    keys: string[];
    action: string;
  }

  interface BrushSizeRow {
    size: number;
    keys: string[];
  }

  const shortcutLabels = (id: string): string[] =>
    (shortcuts[id] ?? []).map(formatShortcutSequence);
  const shortcutRow = (id: string, action: string): Row => ({
    keys: shortcutLabels(id),
    action,
  });
  const toolsRows = $derived<Row[]>(tools.map((tool) => ({
    keys: [tool.hotkeyLabel],
    action: tool.label,
  })));
  const view = $derived<Row[]>([
    { keys: ['Колесо мыши'], action: 'Масштабировать к точке под курсором' },
    shortcutRow('zoom-in', 'Увеличить масштаб вокруг центра рабочей области'),
    shortcutRow('zoom-out', 'Уменьшить масштаб вокруг центра рабочей области'),
    shortcutRow('pan', 'Удерживать и перетаскивать ЛКМ для панорамирования'),
    { keys: ['Средняя кнопка + перетаскивание', 'ПКМ + перетаскивание'], action: 'Панорамировать рабочую область' },
    { keys: ['ПКМ'], action: 'Щелчок по холсту открывает меню его действий' },
    { keys: ['Два пальца'], action: 'Масштабировать и перемещать рабочую область на сенсорном экране' },
    shortcutRow('fit', 'Вписать все холсты в рабочую область'),
    shortcutRow('toggle-grid', 'Показать или скрыть сетку'),
  ]);
  const colors = $derived<Row[]>([
    { keys: ['ЛКМ'], action: 'Рисовать основным цветом' },
    { keys: ['Shift + ЛКМ'], action: 'Рисовать дополнительным цветом, если включена эта опция в настройках' },
    { keys: ['ЛКМ'], action: 'Выбрать основной цвет в палитре' },
    { keys: ['Shift + ЛКМ', 'ПКМ'], action: 'Выбрать дополнительный цвет в палитре' },
    shortcutRow('swap-colors', 'Поменять основной и дополнительный цвета местами'),
    shortcutRow('temporary-picker', 'Временно включить пипетку, пока клавиша удерживается'),
  ]);
  const selection = $derived<Row[]>([
    shortcutRow('copy', 'Копировать выделенную область'),
    shortcutRow('cut', 'Вырезать выделенную область'),
    shortcutRow('paste', 'Вставить скопированную область по центру холста'),
  ]);
  const file = $derived<Row[]>([
    shortcutRow('undo', 'Отменить последнее действие'),
    shortcutRow('redo', 'Повторить отменённое действие'),
    shortcutRow('save', 'Сохранить проект в файл JSON'),
    shortcutRow('help', 'Открыть эту справку'),
  ]);
  const keyboard = $derived<Row[]>([
    { keys: ['←', '↑', '→', '↓'], action: 'Переместить курсор на 1 пиксель; с Shift — на 8' },
    { keys: ['Enter', 'Shift + Enter'], action: 'Начать или завершить штрих; Shift использует дополнительный цвет. Для заливки Enter выполняет её сразу' },
    { keys: ['Escape'], action: 'Прервать штрих с клавиатуры, сбросить незавершённый многоугольник или закрыть меню холста' },
  ]);
  const brushSizes = $derived<BrushSizeRow[]>(Array.from({ length: 9 }, (_, index) => ({
    size: index + 1,
    keys: shortcutLabels(`brush-size:${index + 1}`),
  })));
</script>

<svelte:window onkeydown={onKeydown} />

<div class="backdrop" role="presentation" onmousedown={onBackdropMousedown}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" use:trapFocus={returnFocusTo}>
    <header class="dialog-header">
      <div>
        <p class="eyebrow">СПРАВКА</p>
        <h2 id="help-title">Горячие клавиши</h2>
        <p class="intro">Список показывает текущие сочетания. Изменить их можно в разделе «Настройки → Горячие клавиши».</p>
      </div>
      <div class="header-actions">
        <button type="button" class="btn" bind:this={closeButton} onclick={onclose}>Закрыть</button>
      </div>
    </header>

    <div class="columns">
      <div class="column">
        <section class="card" aria-labelledby="tools-title">
          <div class="card-header"><h3 id="tools-title">Инструменты</h3><span class="count">{tools.length}</span></div>
          <dl class="tool-list">
            {#each toolsRows as row}
              <div class="shortcut-row">
                <dt><kbd>{row.keys[0] || '—'}</kbd></dt>
                <dd>{row.action}</dd>
              </div>
            {/each}
          </dl>
        </section>

        <section class="card" aria-labelledby="keyboard-title">
          <div class="card-header"><h3 id="keyboard-title">Рисование с клавиатуры</h3></div>
          <p class="card-note">Сначала щёлкните по холсту, чтобы сфокусировать рабочее поле.</p>
          <dl>
            {#each keyboard as row}
              <div class="shortcut-row">
                <dt class="key-list">
                  {#each row.keys as key, index}
                    {#if index > 0}<span class="or">или</span>{/if}
                    <kbd>{key}</kbd>
                  {/each}
                </dt>
                <dd>{row.action}</dd>
              </div>
            {/each}
          </dl>
        </section>

        <section class="card" aria-labelledby="brush-size-title">
          <div class="card-header"><h3 id="brush-size-title">Размер кисти</h3></div>
          <p class="card-note">Задаёт толщину карандаша или ластика, в пикселях.</p>
          <div class="size-grid">
            {#each brushSizes as row (row.size)}
              <div class="size-item">
                <span class="size-label">{row.size} px</span>
                <span class="size-keys">
                  {#if row.keys.length}
                    {#each row.keys as key, index}
                      {#if index > 0}<span class="or">или</span>{/if}
                      <kbd>{key}</kbd>
                    {/each}
                  {:else}
                    <span class="unassigned">Не назначено</span>
                  {/if}
                </span>
              </div>
            {/each}
          </div>
        </section>
      </div>

      <div class="column">
        <section class="card" aria-labelledby="view-title">
          <div class="card-header"><h3 id="view-title">Масштаб и перемещение</h3></div>
          <dl>
            {#each view as row}
              <div class="shortcut-row">
                <dt class="key-list">
                  {#if row.keys.length}
                    {#each row.keys as key, index}
                      {#if index > 0}<span class="or">или</span>{/if}
                      <kbd>{key}</kbd>
                    {/each}
                  {:else}
                    <span class="unassigned">Не назначено</span>
                  {/if}
                </dt>
                <dd>{row.action}</dd>
              </div>
            {/each}
          </dl>
        </section>

        <section class="card" aria-labelledby="colors-title">
          <div class="card-header"><h3 id="colors-title">Цвета и пипетка</h3></div>
          <dl>
            {#each colors as row}
              <div class="shortcut-row">
                <dt class="key-list">
                  {#if row.keys.length}
                    {#each row.keys as key, index}
                      {#if index > 0}<span class="or">или</span>{/if}
                      <kbd>{key}</kbd>
                    {/each}
                  {:else}
                    <span class="unassigned">Не назначено</span>
                  {/if}
                </dt>
                <dd>{row.action}</dd>
              </div>
            {/each}
          </dl>
        </section>

        <section class="card" aria-labelledby="selection-title">
          <div class="card-header"><h3 id="selection-title">Выделение</h3></div>
          <dl>
            {#each selection as row}
              <div class="shortcut-row">
                <dt class="key-list">
                  {#if row.keys.length}
                    {#each row.keys as key, index}
                      {#if index > 0}<span class="or">или</span>{/if}
                      <kbd>{key}</kbd>
                    {/each}
                  {:else}
                    <span class="unassigned">Не назначено</span>
                  {/if}
                </dt>
                <dd>{row.action}</dd>
              </div>
            {/each}
          </dl>
        </section>

        <section class="card" aria-labelledby="file-title">
          <div class="card-header"><h3 id="file-title">Проект и история</h3></div>
          <dl>
            {#each file as row}
              <div class="shortcut-row">
                <dt class="key-list">
                  {#if row.keys.length}
                    {#each row.keys as key, index}
                      {#if index > 0}<span class="or">или</span>{/if}
                      <kbd>{key}</kbd>
                    {/each}
                  {:else}
                    <span class="unassigned">Не назначено</span>
                  {/if}
                </dt>
                <dd>{row.action}</dd>
              </div>
            {/each}
          </dl>
        </section>
      </div>
    </div>
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
    background: color-mix(in srgb, var(--bg) 68%, transparent);
    backdrop-filter: blur(6px);
  }

  .dialog {
    width: min(960px, 100%);
    max-height: 90vh;
    max-height: 90dvh;
    overflow-y: auto;
    padding: clamp(16px, 2.5vw, 28px);
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--panel);
    box-shadow: var(--shadow-md), 0 0 0 1px color-mix(in srgb, var(--border) 55%, transparent);
  }

  .dialog-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 18px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }

  .eyebrow {
    margin: 0 0 4px;
    color: var(--accent);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
  }

  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .intro {
    margin: 6px 0 0;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.5;
  }

  .header-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  .columns {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
    align-items: start;
    gap: 14px;
  }

  .column {
    display: grid;
    align-content: start;
    gap: 14px;
  }

  .card {
    min-width: 0;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel-2);
  }

  .card-header {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  h3 {
    margin: 0;
    color: var(--text);
    font-size: 13px;
    font-weight: 650;
  }

  .count {
    display: grid;
    min-width: 22px;
    height: 22px;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-dim);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  dl {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin: 0;
  }

  .shortcut-row {
    display: grid;
    grid-template-columns: minmax(112px, 0.85fr) minmax(0, 1.15fr);
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 8px 0;
  }

  dl > .shortcut-row + .shortcut-row {
    border-top: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  }

  dt,
  dd {
    min-width: 0;
  }

  .tool-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 14px;
    row-gap: 4px;
  }

  .tool-list .shortcut-row {
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 8px;
    padding: 5px 0;
    border-top: 0;
  }

  .key-list,
  .size-keys {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }

  kbd {
    display: inline-block;
    max-width: 100%;
    padding: 3px 6px;
    overflow-wrap: anywhere;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 5px;
    background: var(--panel);
    color: var(--text);
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 550;
    line-height: 1.3;
    text-align: center;
  }

  .or {
    color: var(--text-dim);
    font-size: 10px;
  }

  dd {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.45;
  }

  .card-note {
    margin: -4px 0 10px;
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.4;
  }

  .size-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }

  .size-item {
    display: grid;
    gap: 5px;
    min-width: 0;
    padding: 7px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--panel);
  }

  .size-label {
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 650;
  }

  .size-keys {
    min-height: 22px;
  }

  .size-keys kbd {
    padding: 2px 5px;
    font-size: 10px;
  }

  .unassigned {
    color: var(--text-dim);
    font-size: 11px;
  }

  @media (max-width: 760px) {
    .columns {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 520px) {
    .backdrop {
      padding: 8px;
    }

    .dialog {
      max-height: 94vh;
      max-height: 94dvh;
      padding: 14px;
    }

    .dialog-header {
      gap: 10px;
    }

    h2 {
      font-size: 18px;
    }

    .card {
      padding: 11px;
    }

    .shortcut-row {
      grid-template-columns: minmax(100px, 0.8fr) minmax(0, 1.2fr);
      gap: 8px;
    }

    .tool-list {
      grid-template-columns: minmax(0, 1fr);
    }

  }
</style>
