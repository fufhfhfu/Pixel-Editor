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
</script>

<svelte:window onkeydown={onKeydown} />

<div class="backdrop" role="presentation" onmousedown={onBackdropMousedown}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" use:trapFocus={returnFocusTo}>
    <header>
      <h2 id="help-title">Горячие клавиши</h2>
      <button type="button" class="btn" bind:this={closeButton} onclick={onclose}>Закрыть</button>
    </header>

    <div class="columns">
      <section>
        <h3>Инструменты</h3>
        <dl>
          {#each tools as tool (tool.id)}
            <div><dt><span class="kbd">{tool.hotkeyLabel}</span></dt><dd>{tool.label}</dd></div>
          {/each}
          <div><dt><span class="kbd">1</span>–<span class="kbd">4</span></dt><dd>Размер кисти, px</dd></div>
        </dl>

        <h3>Цвета</h3>
        <dl>
          {#each colors as row (row.keys)}
            <div><dt>{row.keys}</dt><dd>{row.action}</dd></div>
          {/each}
        </dl>
      </section>

      <section>
        <h3>Вид</h3>
        <dl>
          {#each view as row (row.keys)}
            <div><dt>{row.keys}</dt><dd>{row.action}</dd></div>
          {/each}
        </dl>

        <h3>Файл и история</h3>
        <dl>
          {#each file as row (row.keys)}
            <div><dt>{row.keys}</dt><dd>{row.action}</dd></div>
          {/each}
        </dl>

        <h3>Рисование с клавиатуры</h3>
        <dl>
          {#each keyboard as row (row.keys)}
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
    background: rgba(5, 6, 10, 0.65);
    backdrop-filter: blur(2px);
  }

  .dialog {
    width: min(760px, 100%);
    max-height: 100%;
    overflow-y: auto;
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
