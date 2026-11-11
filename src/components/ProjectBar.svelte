<script lang="ts">
  import { EXPORT_FORMATS, EXPORT_SCALES, isExportFormat, type ExportFormat, type ExportScale } from '../core/export';

  interface Props {
    canUndo: boolean;
    canRedo: boolean;
    exportFormat: ExportFormat;
    exportScale: ExportScale;
    availableExportScales: readonly ExportScale[];
    /** Размер изображения в пикселях при выбранном масштабе (для подписи кнопки). */
    exportWidth: number;
    exportHeight: number;
    onundo: () => void;
    onredo: () => void;
    onopen: (file: File) => void;
    onsave: () => void;
    onexport: () => void;
    onexportall: () => void;
    onformat: (format: ExportFormat) => void;
    onscale: (scale: ExportScale) => void;
    onnotes: (trigger: HTMLElement) => void;
    onhelp: (trigger: HTMLElement) => void;
    onsettings: (trigger: HTMLElement) => void;
  }

  let {
    canUndo,
    canRedo,
    exportFormat,
    exportScale,
    availableExportScales,
    exportWidth,
    exportHeight,
    onundo,
    onredo,
    onopen,
    onsave,
    onexport,
    onexportall,
    onformat,
    onscale,
    onnotes,
    onhelp,
    onsettings,
  }: Props = $props();

  let fileInput: HTMLInputElement | undefined = $state();
  let fileMenu: HTMLElement | undefined = $state();
  let fileMenuTrigger: HTMLButtonElement | undefined = $state();
  let fileMenuOpen = $state(false);

  function onFileChange(e: Event & { currentTarget: HTMLInputElement }): void {
    const input = e.currentTarget;
    const file = input.files?.[0];
    // Сброс значения позволяет выбрать тот же файл повторно
    input.value = '';
    if (file) onopen(file);
  }

  function onFormatChange(e: Event & { currentTarget: HTMLSelectElement }): void {
    if (isExportFormat(e.currentTarget.value)) onformat(e.currentTarget.value);
  }

  function closeFileMenu(restoreFocus = false): void {
    fileMenuOpen = false;
    if (restoreFocus) fileMenuTrigger?.focus();
  }

  function onDocumentPointerDown(event: PointerEvent): void {
    if (!(event.target instanceof Node) || !fileMenu?.contains(event.target)) closeFileMenu();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && fileMenuOpen) {
      event.preventDefault();
      closeFileMenu(true);
    }
  }
</script>

<svelte:document onpointerdown={onDocumentPointerDown} />
<svelte:window onkeydown={onKeydown} />

<header class="bar">
  <div class="file-menu" bind:this={fileMenu}>
    <button
      type="button"
      class="btn icon file-menu-trigger"
      aria-label="Действия с файлом"
      aria-expanded={fileMenuOpen}
      title="Открыть или экспортировать"
      bind:this={fileMenuTrigger}
      onclick={() => (fileMenuOpen = !fileMenuOpen)}
    >
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M7 10l5 5 5-5" />
      </svg>
    </button>
    {#if fileMenuOpen}
      <div id="file-actions-menu" class="file-menu-panel" role="group" aria-label="Открытие и экспорт">
        <button
          type="button"
          class="btn"
          title="Открыть проект PXPROJ/JSON или изображение PNG, JPEG, WebP, BMP"
          onclick={() => {
            closeFileMenu();
            fileInput?.click();
          }}
        >Открыть файл…</button>
        <label class="label format-label">
          Формат
          <select aria-label="Формат экспорта" value={exportFormat} onchange={onFormatChange}>
            {#each EXPORT_FORMATS as format (format)}
              <option value={format}>{format === 'jpeg' ? 'JPEG' : format.toUpperCase()}</option>
            {/each}
          </select>
        </label>
        <div class="seg" role="group" aria-label="Масштаб экспорта">
          {#each EXPORT_SCALES as scale (scale)}
            <button
              type="button"
              class="btn seg-btn"
              class:active={scale === exportScale}
              aria-pressed={scale === exportScale}
              disabled={!availableExportScales.includes(scale)}
              title={!availableExportScales.includes(scale) ? 'Этот масштаб превышает лимит безопасного экспорта' : undefined}
              onclick={() => onscale(scale)}
            >×{scale}</button>
          {/each}
        </div>
        <button
          type="button"
          class="btn primary export-button"
          title={exportFormat === 'jpeg' ? 'Экспортировать JPEG; прозрачность будет заменена цветом фона рабочей области' : `Экспортировать ${exportFormat.toUpperCase()}`}
          onclick={() => {
            closeFileMenu();
            onexport();
          }}
        >Экспорт {exportWidth}×{exportHeight}</button>
        <button type="button" class="btn" title="Экспортировать все холсты в отдельные PNG-файлы" onclick={() => { closeFileMenu(); onexportall(); }}>
          Все холсты PNG
        </button>
      </div>
    {/if}
    <input
      class="hidden"
      type="file"
      accept=".pxproj,.json,.png,.jpg,.jpeg,.webp,.bmp,application/json,image/png,image/jpeg,image/webp,image/bmp"
      tabindex="-1"
      aria-hidden="true"
      bind:this={fileInput}
      onchange={onFileChange}
    />
  </div>

  <div class="brand">
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <rect x="1" y="1" width="6" height="6" fill="#7c5cff" />
      <rect x="9" y="1" width="6" height="6" fill="#4a4e60" />
      <rect x="1" y="9" width="6" height="6" fill="#4a4e60" />
      <rect x="9" y="9" width="6" height="6" fill="#7c5cff" />
    </svg>
    <h1>Pixel Editor</h1>
  </div>

  <div class="group">
    <button type="button" class="btn icon" disabled={!canUndo} title="Отменить (Ctrl+Z)" aria-label="Отменить" onclick={onundo}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 14L4 9l5-5" />
        <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
      </svg>
    </button>
    <button type="button" class="btn icon" disabled={!canRedo} title="Повторить (Ctrl+Shift+Z)" aria-label="Повторить" onclick={onredo}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 14l5-5-5-5" />
        <path d="M20 9H10a6 6 0 0 0 0 12h3" />
      </svg>
    </button>
  </div>

  <div class="spacer"></div>

  <div class="group">
    <button
      type="button"
      class="btn icon"
      title="Заметки проекта"
      aria-label="Заметки проекта"
      onclick={(event) => onnotes(event.currentTarget)}
    >✎</button>
    <button
      type="button"
      class="btn icon"
      title="Настройки"
      aria-label="Настройки"
      onclick={(event) => onsettings(event.currentTarget)}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.6 2.77-.08-.03a1.7 1.7 0 0 0-1.8.38l-.06.06h-3.2l-.02-.08a1.7 1.7 0 0 0-1.23-1.37l-.08-.02-1.6-2.77.06-.06A1.7 1.7 0 0 0 10.6 14l-.08-.02v-3.2l.08-.02a1.7 1.7 0 0 0 1.23-1.37l.02-.08h3.2l.06.06a1.7 1.7 0 0 0 1.8.38l.08-.03 1.6 2.77-.06.06A1.7 1.7 0 0 0 19.4 15Z" />
      </svg>
    </button>
    <button
      type="button"
      class="btn icon"
      title="Горячие клавиши (H)"
      aria-label="Горячие клавиши"
      onclick={(event) => onhelp(event.currentTarget)}
    >?</button>
    <button type="button" class="btn" title="Сохранить проект в файл JSON (Ctrl+S)" onclick={onsave}>
      Сохранить <span class="kbd save-hint">Ctrl+S</span>
    </button>
  </div>
</header>

<style>
  .bar {
    position: relative;
    z-index: 110;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    min-height: 44px;
    padding: 6px 14px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-right: 8px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .brand h1 {
    margin: 0;
    font: inherit;
  }

  .file-menu {
    position: relative;
    flex: none;
  }

  .file-menu-panel {
    position: absolute;
    z-index: 111;
    top: calc(100% + 8px);
    left: 0;
    display: grid;
    gap: 10px;
    min-width: 230px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  }

  .file-menu-panel > .btn,
  .export-button {
    justify-content: center;
  }

  .group {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .spacer {
    flex: 1;
  }

  .label {
    color: var(--text-dim);
    font-size: 12px;
  }

  .format-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .format-label select {
    height: 30px;
    padding: 0 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }

  .icon {
    justify-content: center;
    width: 34px;
    padding: 0;
  }

  .seg {
    display: flex;
  }

  .seg-btn {
    min-width: 40px;
    justify-content: center;
    padding: 0 8px;
    border-radius: 0;
    margin-left: -1px;
  }

  .seg-btn:first-child {
    margin-left: 0;
    border-radius: var(--radius) 0 0 var(--radius);
  }

  .seg-btn:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
  }

  .seg-btn.active {
    position: relative;
    z-index: 1;
  }

  .hidden {
    display: none;
  }

  @media (max-width: 720px) {
    .brand h1,
    .save-hint {
      display: none;
    }
  }
</style>
