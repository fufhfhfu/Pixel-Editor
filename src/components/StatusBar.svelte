<script lang="ts">
  import type { SaveStatus } from '../core/storage';
  import type { PixelPos } from '../core/viewport';

  interface Props {
    cursor: PixelPos | null;
    width: number;
    height: number;
    zoom: number;
    toolLabel: string;
    /** Размер кисти; null, если текущий инструмент его не использует. */
    brushSize: number | null;
    saveStatus: SaveStatus;
    /** Время последнего успешного автосохранения (мс) или null. */
    savedAt: number | null;
  }

  let { cursor, width, height, zoom, toolLabel, brushSize, saveStatus, savedAt }: Props = $props();

  const saveText = $derived.by(() => {
    switch (saveStatus) {
      case 'pending':
        return 'сохраняется…';
      case 'saved':
        return savedAt === null
          ? 'включено'
          : `сохранено в ${new Date(savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
      case 'degraded':
        return 'резервное хранилище';
      case 'error':
        return 'ошибка записи';
      case 'unavailable':
        return 'недоступно';
    }
  });
</script>

<footer class="statusbar">
  <div class="item">
    <span class="label">Инструмент</span>
    <span class="value tool">{toolLabel}{brushSize !== null ? `, ${brushSize} px` : ''}</span>
  </div>
  <div class="item">
    <span class="label">Пиксель</span>
    <span class="value">{cursor ? `${cursor.x}, ${cursor.y}` : '—'}</span>
  </div>
  <div class="item hide-small">
    <span class="label">Размер</span>
    <span class="value">{width}×{height}</span>
  </div>
  <div class="item">
    <span class="label">Зум</span>
    <span class="value">{Math.round(zoom * 100)}%</span>
  </div>
  <div class="spacer"></div>
  <div class="item" title={saveStatus === 'degraded' ? 'IndexedDB недоступна: проект сохраняется в localStorage с ограниченной квотой' : 'Проект автоматически сохраняется в браузере'}>
    <span class="label hide-small">Автосохранение</span>
    <span class="value save" class:bad={saveStatus === 'error' || saveStatus === 'unavailable' || saveStatus === 'degraded'}>{saveText}</span>
  </div>
</footer>

<style>
  .statusbar {
    display: flex;
    align-items: center;
    gap: 24px;
    min-height: 28px;
    padding: 0 14px;
    overflow: hidden;
    white-space: nowrap;
    background: var(--panel);
    border-top: 1px solid var(--border);
    font-size: 12px;
  }

  .item {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .label {
    color: var(--text-dim);
  }

  .value {
    min-width: 56px;
    font-family: var(--mono);
    color: var(--text);
  }

  .value.tool {
    min-width: 128px;
  }

  .spacer {
    flex: 1;
  }

  .value.save {
    min-width: 0;
  }

  .value.bad {
    color: var(--danger);
  }

  @media (max-width: 720px) {
    .statusbar {
      gap: 14px;
    }

    .hide-small {
      display: none;
    }

    .value.tool {
      min-width: 0;
    }
  }
</style>
