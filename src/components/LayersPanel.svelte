<script lang="ts">
  import type {
    LayerBlendMode,
    LayerGroup,
    LayerGroupUpdate,
    LayerRole,
    LayerUpdate,
    RasterLayer,
  } from '../core/layers';

  interface Props {
    layers: readonly RasterLayer[];
    groups: readonly LayerGroup[];
    activeLayerId: string;
    hasSelection: boolean;
    onselect: (id: string) => void;
    onadd: () => void;
    onaddgroup: () => void;
    ongroupupdate: (id: string, update: LayerGroupUpdate) => void;
    ongroupdelete: (id: string) => void;
    onaddbackground: () => void;
    onaddreference: () => void;
    onduplicate: (id: string) => void;
    ondelete: (id: string) => void;
    onmove: (id: string, direction: -1 | 1) => void;
    onreorder: (sourceId: string, targetId: string) => void;
    onupdate: (id: string, update: LayerUpdate) => void;
    oncreatefromselection: () => void;
  }

  let {
    layers,
    groups,
    activeLayerId,
    hasSelection,
    onselect,
    onadd,
    onaddgroup,
    ongroupupdate,
    ongroupdelete,
    onaddbackground,
    onaddreference,
    onduplicate,
    ondelete,
    onmove,
    onreorder,
    onupdate,
    oncreatefromselection,
  }: Props = $props();

  const activeLayer = $derived(layers.find((layer) => layer.id === activeLayerId) ?? null);
  const groupById = $derived(new Map(groups.map((group) => [group.id, group])));
  let draggedLayerId: string | null = null;
  const blendModes: readonly { value: LayerBlendMode; label: string }[] = [
    { value: 'normal', label: 'Обычный' },
    { value: 'multiply', label: 'Умножение' },
    { value: 'screen', label: 'Экран' },
    { value: 'overlay', label: 'Перекрытие' },
    { value: 'add', label: 'Сложение' },
  ];
  const layerRoles: readonly { value: LayerRole; label: string }[] = [
    { value: 'paint', label: 'Рисующий' },
    { value: 'background', label: 'Фон (фиксированный)' },
    { value: 'reference', label: 'Референс (не экспортируется)' },
  ];

  function groupDepth(group: LayerGroup): number {
    let depth = 0;
    let parentId = group.parentGroupId;
    while (parentId) {
      depth++;
      parentId = groupById.get(parentId)?.parentGroupId ?? null;
    }
    return depth;
  }

  function groupLabel(group: LayerGroup): string {
    return `${'　'.repeat(groupDepth(group))}${group.name}`;
  }

  function layerGroupDepth(layer: RasterLayer): number {
    let depth = 0;
    let groupId = layer.groupId ?? null;
    while (groupId) {
      depth++;
      groupId = groupById.get(groupId)?.parentGroupId ?? null;
    }
    return depth;
  }

  function layerGroupPath(layer: RasterLayer): string {
    const path: string[] = [];
    let groupId = layer.groupId ?? null;
    while (groupId) {
      const group = groupById.get(groupId);
      if (!group) break;
      path.push(group.name);
      groupId = group.parentGroupId;
    }
    return path.reverse().join(' / ');
  }

  function thumbnail(node: HTMLCanvasElement, initialLayer: RasterLayer) {
    let layer = initialLayer;
    let renderTimer: ReturnType<typeof setTimeout> | null = null;
    function render(): void {
      node.width = 32;
      node.height = 32;
      const context = node.getContext('2d');
      if (!context) throw new Error('Не удалось создать миниатюру слоя.');
      const scale = Math.min(32 / layer.buffer.width, 32 / layer.buffer.height);
      const width = Math.max(1, Math.round(layer.buffer.width * scale));
      const height = Math.max(1, Math.round(layer.buffer.height * scale));
      const offsetX = Math.floor((32 - width) / 2);
      const offsetY = Math.floor((32 - height) / 2);
      const image = context.getImageData(0, 0, 32, 32);
      image.data.fill(0);
      for (let y = 0; y < height; y++) {
        const sourceY = Math.min(layer.buffer.height - 1, Math.floor((y * layer.buffer.height) / height));
        for (let x = 0; x < width; x++) {
          const sourceX = Math.min(layer.buffer.width - 1, Math.floor((x * layer.buffer.width) / width));
          const source = layer.buffer.index(sourceX, sourceY);
          const target = ((offsetY + y) * 32 + offsetX + x) * 4;
          image.data.set(layer.buffer.data.subarray(source, source + 4), target);
        }
      }
      context.putImageData(image, 0, 0);
    }
    const scheduleRender = () => {
      if (renderTimer !== null) return;
      renderTimer = setTimeout(() => {
        renderTimer = null;
        render();
      }, 0);
    };
    let stopObserving = layer.buffer.captureChanges(scheduleRender);
    render();
    return {
      update(nextLayer: RasterLayer) {
        if (nextLayer.buffer !== layer.buffer) {
          stopObserving();
          stopObserving = nextLayer.buffer.captureChanges(scheduleRender);
        }
        layer = nextLayer;
        render();
      },
      destroy() {
        stopObserving();
        if (renderTimer !== null) clearTimeout(renderTimer);
      },
    };
  }
</script>

<details class="layers-panel">
  <summary>Слои ({layers.length})</summary>
  <div class="options-panel">
    <div class="layer-actions">
      <button type="button" aria-label="Добавить слой" title="Добавить слой" onclick={onadd}>＋</button>
      <button type="button" aria-label="Создать группу" title="Создать группу из активного слоя" onclick={onaddgroup}>▱</button>
      <button type="button" aria-label="Добавить фон" title="Добавить белый фон" onclick={onaddbackground}>▰</button>
      <button type="button" aria-label="Создать референс" title="Создать референс из композиции" onclick={onaddreference}>◇</button>
      <button type="button" aria-label="Дублировать слой" title="Дублировать слой" disabled={!activeLayer}
        onclick={() => activeLayer && onduplicate(activeLayer.id)}>⧉</button>
      <button type="button" aria-label="Удалить слой" title="Удалить слой" disabled={!activeLayer || layers.length <= 1}
        onclick={() => activeLayer && ondelete(activeLayer.id)}>−</button>
      <button type="button" aria-label="Слой выше" title="Переместить выше" disabled={!activeLayer || layers.at(-1)?.id === activeLayer.id}
        onclick={() => activeLayer && onmove(activeLayer.id, 1)}>↑</button>
      <button type="button" aria-label="Слой ниже" title="Переместить ниже" disabled={!activeLayer || layers[0]?.id === activeLayer.id}
        onclick={() => activeLayer && onmove(activeLayer.id, -1)}>↓</button>
    </div>
    {#if groups.length > 0}
      <ul class="group-list" aria-label="Группы слоёв">
        {#each groups as group (group.id)}
          <li style={`--group-depth:${groupDepth(group)}`}>
            <input aria-label={`Имя группы ${group.name}`} maxlength="80" value={group.name}
              onchange={(event) => ongroupupdate(group.id, { name: event.currentTarget.value })} />
            <button type="button" class="icon" aria-label={`${group.visible ? 'Скрыть' : 'Показать'} группу ${group.name}`}
              aria-pressed={group.visible}
              onclick={() => ongroupupdate(group.id, { visible: !group.visible })}>{group.visible ? '◉' : '○'}</button>
            <button type="button" class="icon" aria-label={`${group.locked ? 'Разблокировать' : 'Заблокировать'} группу ${group.name}`}
              aria-pressed={group.locked}
              onclick={() => ongroupupdate(group.id, { locked: !group.locked })}>{group.locked ? '🔒' : '◇'}</button>
            <details class="group-settings">
              <summary aria-label={`Параметры группы ${group.name}`}>⋯</summary>
              <label>Непрозрачность группы {Math.round(group.opacity * 100)}%
                <input aria-label={`Непрозрачность группы ${group.name}`} type="range" min="0" max="100"
                  value={group.opacity * 100}
                  onchange={(event) => ongroupupdate(group.id, { opacity: Number(event.currentTarget.value) / 100 })} />
              </label>
              <label>Режим группы
                <select aria-label={`Режим группы ${group.name}`} value={group.blendMode}
                  onchange={(event) => ongroupupdate(group.id, { blendMode: event.currentTarget.value as LayerBlendMode })}>
                  {#each blendModes as mode (mode.value)}
                    <option value={mode.value}>{mode.label}</option>
                  {/each}
                </select>
              </label>
              {#each [
                { key: 'brightness', label: 'Яркость' },
                { key: 'contrast', label: 'Контраст' },
                { key: 'saturation', label: 'Насыщенность' },
              ] as effect (effect.key)}
                <label>{effect.label} группы {group.effects[effect.key as keyof typeof group.effects]}
                  <input aria-label={`${effect.label} группы ${group.name}`} type="range" min="-100" max="100"
                    value={group.effects[effect.key as keyof typeof group.effects]}
                    onchange={(event) => ongroupupdate(group.id, {
                      effects: { [effect.key]: Number(event.currentTarget.value) },
                    })} />
                </label>
              {/each}
            </details>
            <button type="button" class="icon" aria-label={`Удалить группу ${group.name}`}
              onclick={() => ongroupdelete(group.id)}>−</button>
          </li>
        {/each}
      </ul>
    {/if}
    <ol class="layer-list" aria-label="Список слоёв">
      {#each [...layers].reverse() as layer, index (layer.id)}
        <li
          class:active={layer.id === activeLayerId}
          draggable="true"
          ondragstart={(event) => {
            draggedLayerId = layer.id;
            event.dataTransfer?.setData('text/plain', layer.id);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
          }}
          ondragover={(event) => event.preventDefault()}
          ondrop={(event) => {
            event.preventDefault();
            const sourceId = draggedLayerId ?? event.dataTransfer?.getData('text/plain') ?? '';
            if (sourceId && sourceId !== layer.id) onreorder(sourceId, layer.id);
            draggedLayerId = null;
          }}
          ondragend={() => (draggedLayerId = null)}
        >
          <button type="button" class="layer-select" aria-pressed={layer.id === activeLayerId}
            onclick={() => onselect(layer.id)}>
            {#if layer.groupId}
              <span class="group-indicator" aria-hidden="true" title={layerGroupPath(layer)}>
                {'↳'.repeat(layerGroupDepth(layer))}
              </span>
            {/if}
            <canvas class="thumbnail" use:thumbnail={layer} aria-hidden="true"></canvas>
            <span>{layer.name}</span>
          </button>
          <button type="button" class="icon" aria-label={`${layer.visible ? 'Скрыть' : 'Показать'} ${layer.name}`}
            aria-pressed={layer.visible} onclick={() => onupdate(layer.id, { visible: !layer.visible })}>
            {layer.visible ? '◉' : '○'}
          </button>
          <button type="button" class="icon" aria-label={`${layer.locked ? 'Разблокировать' : 'Заблокировать'} ${layer.name}`}
            aria-pressed={layer.locked} disabled={layer.role === 'background' || layer.role === 'reference'}
            onclick={() => onupdate(layer.id, { locked: !layer.locked })}>
            {layer.locked ? '🔒' : '◇'}
          </button>
        </li>
      {/each}
    </ol>
    {#if activeLayer}
      <label>Имя
        <input aria-label="Имя активного слоя" maxlength="80" value={activeLayer.name}
          onchange={(event) => onupdate(activeLayer.id, { name: event.currentTarget.value })} />
      </label>
      <label>Тип слоя
        <select aria-label="Тип слоя" value={activeLayer.role ?? 'paint'}
          onchange={(event) => onupdate(activeLayer.id, { role: event.currentTarget.value as LayerRole })}>
          {#each layerRoles as role (role.value)}
            <option value={role.value}>{role.label}</option>
          {/each}
        </select>
      </label>
      <label>Группа
        <select aria-label="Группа активного слоя" value={activeLayer.groupId ?? ''} disabled={activeLayer.role === 'background'}
          onchange={(event) => onupdate(activeLayer.id, { groupId: event.currentTarget.value || null })}>
          <option value="">Без группы</option>
          {#each groups as group (group.id)}
            <option value={group.id}>{groupLabel(group)}</option>
          {/each}
        </select>
      </label>
      <label>Непрозрачность {Math.round(activeLayer.opacity * 100)}%
        <input aria-label="Непрозрачность слоя" type="range" min="0" max="100" step="1"
          value={activeLayer.opacity * 100}
          onchange={(event) => onupdate(activeLayer.id, { opacity: Number(event.currentTarget.value) / 100 })} />
      </label>
      <label>Режим наложения
        <select aria-label="Режим наложения слоя" value={activeLayer.blendMode}
          onchange={(event) => onupdate(activeLayer.id, { blendMode: event.currentTarget.value as LayerBlendMode })}>
          {#each blendModes as mode (mode.value)}
            <option value={mode.value}>{mode.label}</option>
          {/each}
        </select>
      </label>
      <label class="check">
        <input type="checkbox" checked={activeLayer.alphaLock} disabled={activeLayer.role === 'background' || activeLayer.role === 'reference'}
          onchange={(event) => onupdate(activeLayer.id, { alphaLock: event.currentTarget.checked })} />
        Alpha Lock
      </label>
      <label class="check">
        <input type="checkbox" checked={activeLayer.clippingMask} disabled={activeLayer.role === 'background' || activeLayer.role === 'reference'}
          onchange={(event) => onupdate(activeLayer.id, { clippingMask: event.currentTarget.checked })} />
        Clipping Mask
      </label>
      <fieldset class="effects">
        <legend>Цветовые эффекты (неразрушающие)</legend>
        {#each [
          { key: 'brightness', label: 'Яркость' },
          { key: 'contrast', label: 'Контраст' },
          { key: 'saturation', label: 'Насыщенность' },
        ] as effect (effect.key)}
          <label>{effect.label} {activeLayer.effects?.[effect.key as keyof NonNullable<RasterLayer['effects']>] ?? 0}
            <input aria-label={`${effect.label} слоя`} type="range" min="-100" max="100" step="1"
              value={activeLayer.effects?.[effect.key as keyof NonNullable<RasterLayer['effects']>] ?? 0}
              onchange={(event) => onupdate(activeLayer.id, {
                effects: { [effect.key]: Number(event.currentTarget.value) },
              })} />
          </label>
        {/each}
      </fieldset>
      <button type="button" class="create-selection-layer" disabled={!hasSelection}
        onclick={oncreatefromselection}>Создать слой из выделения</button>
    {/if}
    <span class="note">Перетаскивайте строку слоя, чтобы изменить порядок.</span>
  </div>
</details>

<style>
  .layers-panel {
    position: relative;
  }

  .layers-panel > summary {
    display: grid;
    place-items: center;
    min-width: 40px;
    min-height: 30px;
    padding: 0 5px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text);
    cursor: pointer;
    font-size: 11px;
    list-style: none;
  }

  .layers-panel > summary::-webkit-details-marker {
    display: none;
  }

  .options-panel {
    position: absolute;
    z-index: 40;
    top: 0;
    left: calc(100% + 8px);
    display: grid;
    gap: 9px;
    width: 290px;
    max-height: min(80vh, 620px);
    padding: 12px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .options-panel label {
    display: grid;
    gap: 4px;
    color: var(--text-dim);
    font-size: 12px;
  }

  .options-panel input:not([type='checkbox']) {
    min-height: 30px;
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--text);
  }

  .options-panel input[type='range'] {
    accent-color: var(--accent);
  }

  .options-panel select {
    min-height: 30px;
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--text);
  }

  .options-panel .check {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text);
  }

  .effects {
    display: grid;
    gap: 7px;
    margin: 0;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .effects legend {
    color: var(--text-dim);
    font-size: 11px;
  }

  .note {
    color: var(--text-dim);
    font-size: 11px;
  }

  .layer-actions,
  .layer-list li {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .layer-actions button,
  .icon,
  .layer-select,
  .create-selection-layer {
    min-height: 30px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .group-indicator {
    color: var(--text-dim);
  }

  .layer-actions button {
    flex: 1;
  }

  .layer-actions button:disabled,
  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .layer-list {
    display: grid;
    gap: 4px;
    max-height: 220px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .group-list {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .group-list li {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    padding-left: calc(var(--group-depth) * 12px);
  }

  .group-settings {
    position: relative;
  }

  .group-settings > summary {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text);
    cursor: pointer;
    list-style: none;
  }

  .group-settings > summary::-webkit-details-marker {
    display: none;
  }

  .group-settings > label {
    margin: 8px;
  }

  .group-list input {
    flex: 1;
    min-width: 0;
  }

  .layer-list li {
    min-width: 0;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
  }

  .layer-list li.active {
    border-color: var(--accent);
  }

  .layer-select {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    border: 0;
    text-align: left;
  }

  .layer-select span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thumbnail {
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    background-color: var(--panel-2);
    background-image: linear-gradient(45deg, #7773 25%, transparent 25%), linear-gradient(-45deg, #7773 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #7773 75%), linear-gradient(-45deg, transparent 75%, #7773 75%);
    background-size: 8px 8px;
    background-position: 0 0, 0 4px, 4px -4px, -4px 0;
    image-rendering: pixelated;
  }

  .icon {
    width: 30px;
    flex: 0 0 30px;
  }

  .create-selection-layer {
    padding: 4px 8px;
  }

  @media (max-width: 859px) {
    .options-panel {
      top: calc(100% + 6px);
      left: 0;
    }

    .layer-list {
      max-height: 120px;
    }
  }
</style>
