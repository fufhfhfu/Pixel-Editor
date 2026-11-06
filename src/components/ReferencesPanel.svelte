<script lang="ts">
  import type { ReferenceImage } from '../core/reference';

  interface Props {
    references: readonly ReferenceImage[];
    docked?: boolean;
    selectedReferenceId: string | null;
    onimport: (file: File) => void;
    onselect: (id: string) => void;
    onupdate: (
      id: string,
      update: Partial<Pick<ReferenceImage, 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'visible' | 'locked'>>,
    ) => void;
    onremove: (id: string) => void;
    onclose: () => void;
  }

  let { references, docked = false, selectedReferenceId, onimport, onselect, onupdate, onremove, onclose }: Props = $props();
  let fileInput: HTMLInputElement | undefined;
  const selected = $derived(references.find((reference) => reference.id === selectedReferenceId) ?? null);

  function importFile(event: Event & { currentTarget: HTMLInputElement }): void {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (file) onimport(file);
  }

  function updateNumber(
    field: 'x' | 'y' | 'scale' | 'rotation',
    event: Event & { currentTarget: HTMLInputElement },
  ): void {
    const value = Number(event.currentTarget.value);
    if (Number.isFinite(value) && selected) onupdate(selected.id, { [field]: value });
  }
</script>

<aside class="references-panel" class:docked aria-label="Менеджер референсов">
  <header>
    <h2>Референсы</h2>
    <button type="button" class="icon-button" aria-label="Закрыть панель референсов" onclick={onclose}>×</button>
  </header>

  <button type="button" class="import-button" onclick={() => fileInput?.click()}>Импортировать изображение</button>
  <input
    bind:this={fileInput}
    class="hidden-input"
    type="file"
    accept=".png,.jpg,.jpeg,.webp,.bmp,image/png,image/jpeg,image/webp,image/bmp"
    aria-label="Импортировать изображение референса"
    onchange={importFile}
  />

  {#if references.length === 0}
    <p class="empty">Добавьте изображение — оно появится поверх рабочего поля и не попадёт в экспорт.</p>
  {:else}
    <ul class="reference-list">
      {#each references as reference (reference.id)}
        <li class:selected={reference.id === selectedReferenceId}>
          <button
            type="button"
            class="reference-name"
            aria-pressed={reference.id === selectedReferenceId}
            onclick={() => onselect(reference.id)}
            title={reference.name}
          >{reference.name}</button>
          <button
            type="button"
            class="icon-button"
            aria-label="{reference.visible ? 'Скрыть' : 'Показать'} {reference.name}"
            aria-pressed={reference.visible}
            onclick={() => onupdate(reference.id, { visible: !reference.visible })}
          >{reference.visible ? '◉' : '○'}</button>
          <button
            type="button"
            class="icon-button"
            aria-label="{reference.locked ? 'Разблокировать' : 'Заблокировать'} {reference.name}"
            aria-pressed={reference.locked}
            onclick={() => onupdate(reference.id, { locked: !reference.locked })}
          >{reference.locked ? '🔒' : '◇'}</button>
          <button
            type="button"
            class="icon-button remove"
            aria-label="Удалить {reference.name}"
            onclick={() => onremove(reference.id)}
          >×</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if selected}
    <fieldset>
      <legend>{selected.width}×{selected.height} px</legend>
      <label>
        X
        <input type="number" step="1" value={selected.x} disabled={selected.locked} onchange={(event) => updateNumber('x', event)} />
      </label>
      <label>
        Y
        <input type="number" step="1" value={selected.y} disabled={selected.locked} onchange={(event) => updateNumber('y', event)} />
      </label>
      <label>
        Масштаб
        <input type="number" min="0.05" max="32" step="0.05" value={selected.scale} disabled={selected.locked} onchange={(event) => updateNumber('scale', event)} />
      </label>
      <label>
        Поворот
        <input type="number" min="-360" max="360" step="1" value={selected.rotation} disabled={selected.locked} onchange={(event) => updateNumber('rotation', event)} />
      </label>
      <label class="opacity">
        Непрозрачность
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={Math.round(selected.opacity * 100)}
          aria-label="Непрозрачность референса"
          oninput={(event) => onupdate(selected.id, { opacity: Number(event.currentTarget.value) / 100 })}
        />
        <output>{Math.round(selected.opacity * 100)}%</output>
      </label>
      <p class="hint">{selected.locked ? 'Референс заблокирован.' : 'Перетаскивайте изображение на холсте для перемещения.'}</p>
    </fieldset>
  {/if}
</aside>

<style>
  .references-panel {
    position: absolute;
    z-index: 20;
    top: 12px;
    right: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(320px, calc(100% - 24px));
    max-height: calc(100% - 24px);
    overflow: auto;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    box-shadow: 0 8px 28px #0006;
  }

  .references-panel.docked {
    position: relative;
    inset: auto;
    width: 100%;
    height: 100%;
    max-height: 100%;
    box-sizing: border-box;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  header,
  .reference-list li,
  label {
    display: flex;
    align-items: center;
  }

  header {
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-size: 14px;
  }

  button,
  input {
    color: var(--text);
    font: inherit;
  }

  .icon-button,
  .import-button,
  .reference-name {
    min-height: 30px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel-2);
    cursor: pointer;
  }

  .icon-button {
    min-width: 30px;
    padding: 0 6px;
  }

  .import-button {
    padding: 0 10px;
  }

  .reference-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 180px;
    overflow: auto;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .reference-list li {
    gap: 4px;
    padding: 3px;
    border-radius: 6px;
  }

  .reference-list li.selected {
    background: var(--accent-soft);
  }

  .reference-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    padding: 0 8px;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .remove {
    color: #f08080;
  }

  .hidden-input {
    display: none;
  }

  fieldset {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 0;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  legend,
  .hint,
  .empty {
    color: var(--text-dim);
    font-size: 12px;
  }

  label {
    justify-content: space-between;
    gap: 6px;
    font-size: 12px;
  }

  label input[type='number'] {
    width: 82px;
    min-height: 28px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg);
    padding: 2px 5px;
  }

  .opacity {
    grid-column: 1 / -1;
  }

  .opacity input {
    flex: 1;
    min-width: 40px;
  }

  output {
    width: 38px;
    text-align: right;
  }

  .hint,
  .empty {
    grid-column: 1 / -1;
    margin: 0;
  }
</style>
