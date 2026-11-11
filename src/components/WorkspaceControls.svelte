<script lang="ts">
  import type { WorkspaceId } from '../core/workspace';

  interface Props {
    workspace: WorkspaceId;
    toolsVisible: boolean;
    paletteVisible: boolean;
    timelineVisible: boolean;
    onworkspace: (workspace: WorkspaceId) => void;
    ontoggletools: () => void;
    ontogglepalette: () => void;
    ontoggletimeline: () => void;
  }

  let {
    workspace,
    toolsVisible,
    paletteVisible,
    timelineVisible,
    onworkspace,
    ontoggletools,
    ontogglepalette,
    ontoggletimeline,
  }: Props = $props();

  function onSelect(event: Event & { currentTarget: HTMLSelectElement }): void {
    const value = event.currentTarget.value;
    if (value === 'drawing' || value === 'animation' || value === 'tileset' || value === 'minimal') {
      onworkspace(value);
    }
  }
</script>

<div class="workspace-controls" aria-label="Рабочее пространство">
  <label>
    <span>Рабочее пространство</span>
    <select aria-label="Рабочее пространство" value={workspace} onchange={onSelect}>
      <option value="drawing">Рисование</option>
      <option value="animation">Анимация</option>
      <option value="tileset">Tileset</option>
      <option value="minimal">Минимальное</option>
    </select>
  </label>
  <div class="dock-toggles" role="group" aria-label="Панели рабочего пространства">
    <button type="button" class:active={toolsVisible} aria-pressed={toolsVisible}
      title={toolsVisible ? 'Скрыть панель инструментов' : 'Показать панель инструментов'}
      onclick={ontoggletools}>Инструменты</button>
    <button type="button" class:active={paletteVisible} aria-pressed={paletteVisible}
      title={paletteVisible ? 'Скрыть панель палитры' : 'Показать панель палитры'}
      onclick={ontogglepalette}>Палитра</button>
    <button type="button" class:active={timelineVisible} aria-pressed={timelineVisible}
      title={timelineVisible ? 'Скрыть Timeline' : 'Показать Timeline'}
      onclick={ontoggletimeline}>Timeline</button>
  </div>
</div>

<style>
  .workspace-controls, label, .dock-toggles {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .workspace-controls {
    min-height: 36px;
    padding: 4px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }

  label span {
    color: var(--text-dim);
    font-size: 11px;
  }

  select, button {
    min-height: 28px;
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text);
    font: inherit;
  }

  button { cursor: pointer; }
  button.active { border-color: var(--accent); background: var(--accent-soft); }
  button:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  @media (max-width: 600px) {
    .workspace-controls { flex-wrap: wrap; }
    label { flex: 1; }
    label span { display: none; }
    select { flex: 1; min-width: 0; }
    .dock-toggles { margin-left: auto; }
  }
</style>
