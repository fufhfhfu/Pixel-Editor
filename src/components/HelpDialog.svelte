<script lang="ts">
  import type { Tool } from '../core/tools';
  import { trapFocus } from './focusTrap';

  interface Props {
    tools: readonly Tool[];
    returnFocusTo: HTMLElement | null;
    onclose: () => void;
  }

  let { tools, returnFocusTo, onclose }: Props = $props();

  let closeButton: HTMLButtonElement | undefined = $state();
  let search = $state('');

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
    keys: string;
    action: string;
  }

  const view: Row[] = [
    { keys: 'Колесо мыши', action: 'Масштаб к точке под курсором' },
    { keys: '+ / −', action: 'Масштаб вокруг центра' },
    { keys: 'Пробел + перетаскивание', action: 'Панорама (также средняя кнопка мыши или перетаскивание ПКМ)' },
    { keys: 'Два пальца', action: 'Масштаб и перемещение на сенсорном экране' },
    { keys: 'F', action: 'Вписать холст в окно' },
    { keys: 'G', action: 'Показать или скрыть сетку' },
  ];
  const colors: Row[] = [
    { keys: 'ЛКМ / клик ПКМ', action: 'Рисовать основным / дополнительным цветом; перетаскивание ПКМ панорамирует холст' },
    { keys: 'X', action: 'Поменять цвета местами' },
    { keys: 'ЛКМ / ПКМ по палитре', action: 'Выбрать основной / дополнительный цвет (также Shift+клик)' },
  ];
  const file: Row[] = [
    { keys: 'Ctrl+Z', action: 'Отменить' },
    { keys: 'Ctrl+Shift+Z, Ctrl+Y', action: 'Повторить' },
    { keys: 'Ctrl+S', action: 'Сохранить проект в файл JSON' },
    { keys: 'H, F1', action: 'Эта справка' },
  ];
  const keyboard: Row[] = [
    { keys: 'Tab', action: 'Перейти на холст' },
    { keys: '← ↑ → ↓', action: 'Двигать курсор на один пиксель (с Shift — на 8)' },
    { keys: 'Enter', action: 'Начать штрих, повторное нажатие — закончить (Shift+Enter — дополнительным цветом)' },
    { keys: 'Escape', action: 'Отменить текущий штрих целиком' },
  ];

  function visibleRows(rows: readonly Row[]): Row[] {
    const term = search.trim().toLocaleLowerCase('ru-RU');
    if (!term) return [...rows];
    return rows.filter((row) => `${row.keys} ${row.action}`.toLocaleLowerCase('ru-RU').includes(term));
  }

  function visibleTools(): readonly Tool[] {
    const term = search.trim().toLocaleLowerCase('ru-RU');
    if (!term) return tools;
    return tools.filter((tool) => `${tool.label} ${tool.hotkeyLabel} ${tool.hint}`.toLocaleLowerCase('ru-RU').includes(term));
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="backdrop" role="presentation" onmousedown={onBackdropMousedown}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" use:trapFocus={returnFocusTo}>
    <header>
      <h2 id="help-title">Горячие клавиши</h2>
      <button type="button" class="btn" bind:this={closeButton} onclick={onclose}>Закрыть</button>
    </header>

    <input class="search" type="search" placeholder="Поиск по командам и сочетаниям…" aria-label="Поиск в справке" bind:value={search} />

    <div class="columns">
      <section>
        <h3>Инструменты</h3>
        <dl>
          {#each visibleTools() as tool (tool.id)}
            <div><dt><span class="kbd">{tool.hotkeyLabel}</span></dt><dd>{tool.label}</dd></div>
          {/each}
          <div><dt><span class="kbd">1</span>–<span class="kbd">4</span></dt><dd>Размер кисти, px</dd></div>
        </dl>

        <h3>Цвета</h3>
        <dl>
          {#each visibleRows(colors) as row (row.keys)}
            <div><dt>{row.keys}</dt><dd>{row.action}</dd></div>
          {/each}
        </dl>
      </section>

      <section>
        <h3>Вид</h3>
        <dl>
          {#each visibleRows(view) as row (row.keys)}
            <div><dt>{row.keys}</dt><dd>{row.action}</dd></div>
          {/each}
        </dl>

        <h3>Файл и история</h3>
        <dl>
          {#each visibleRows(file) as row (row.keys)}
            <div><dt>{row.keys}</dt><dd>{row.action}</dd></div>
          {/each}
        </dl>

        <h3>Рисование с клавиатуры</h3>
        <dl>
          {#each visibleRows(keyboard) as row (row.keys)}
            <div><dt>{row.keys}</dt><dd>{row.action}</dd></div>
          {/each}
        </dl>
      </section>
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
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(8px);
  }

  .dialog {
    width: min(760px, 100%);
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
    margin-bottom: 8px;
  }

  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  h3 {
    margin: 16px 0 6px;
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 500;
  }

  .search {
    width: 100%;
    height: 36px;
    margin-bottom: 4px;
    padding: 0 11px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--text);
  }

  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 0 28px;
  }

  dl {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
  }

  dl div {
    display: grid;
    grid-template-columns: minmax(96px, 38%) 1fr;
    gap: 12px;
    align-items: baseline;
  }

  dt {
    font-family: var(--mono);
    font-size: 12px;
  }

  dd {
    margin: 0;
    line-height: 1.4;
  }
</style>
