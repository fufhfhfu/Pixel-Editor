<script lang="ts">
  import { onMount } from 'svelte';
  import { trapFocus } from './focusTrap';

  interface Props {
    returnFocusTo: HTMLElement | null;
    onclose: () => void;
  }

  let { returnFocusTo, onclose }: Props = $props();
  let appInfo = $state<DesktopAppInfo | null>(null);
  let updateStatus = $state<DesktopUpdateStatus>({ status: 'idle' });
  let errorMessage = $state('');
  let closeButton: HTMLButtonElement | undefined = $state();

  $effect(() => closeButton?.focus());

  onMount(() => {
    const desktop = window.pixelEditorDesktop;
    if (!desktop) return;
    const unsubscribe = desktop.onUpdateStatus((status) => {
      updateStatus = status;
      errorMessage = '';
    });
    void desktop.getAppInfo()
      .then((info) => {
        appInfo = info;
        if (updateStatus.status === 'checking') updateStatus = { status: 'idle' };
      })
      .catch((error: unknown) => {
        errorMessage = error instanceof Error ? error.message : String(error);
      });
    return unsubscribe;
  });

  async function checkForUpdates(): Promise<void> {
    updateStatus = { status: 'checking' };
    errorMessage = '';
    try {
      await window.pixelEditorDesktop?.checkForUpdates();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      updateStatus = { status: 'error', message: errorMessage };
    }
  }

  async function downloadUpdate(): Promise<void> {
    errorMessage = '';
    try {
      await window.pixelEditorDesktop?.downloadUpdate();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      updateStatus = { status: 'error', message: errorMessage };
    }
  }

  async function installUpdate(): Promise<void> {
    errorMessage = '';
    try {
      await window.pixelEditorDesktop?.installUpdate();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

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
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="about-title" use:trapFocus={returnFocusTo}>
    <header>
      <div>
        <p class="eyebrow">PIXEL EDITOR</p>
        <h2 id="about-title">О программе</h2>
      </div>
      <button type="button" class="btn" bind:this={closeButton} onclick={onclose}>Закрыть</button>
    </header>

    <p class="version">Версия {appInfo?.version ?? '…'}</p>
    <section aria-labelledby="updates-title">
      <h3 id="updates-title">Обновления</h3>
      {#if appInfo && !appInfo.updatesSupported}
        <p role="status">Обновления доступны только в подписанной сборке Windows.</p>
      {:else}
        {#if updateStatus.status === 'checking'}
          <p role="status">Проверяем наличие обновлений…</p>
        {:else if updateStatus.status === 'current'}
          <p role="status">Установлена последняя версия ({updateStatus.version}).</p>
        {:else if updateStatus.status === 'available'}
          <p role="status">Доступна версия {updateStatus.version}.</p>
        {:else if updateStatus.status === 'downloading'}
          <p role="status">Загрузка обновления: {Math.round(updateStatus.percent)}%</p>
          <progress aria-label="Загрузка обновления" value={updateStatus.percent} max="100"></progress>
        {:else if updateStatus.status === 'downloaded'}
          <p role="status">Версия {updateStatus.version} загружена и готова к установке.</p>
        {:else if updateStatus.status === 'error'}
          <p class="error" role="alert">{updateStatus.message}</p>
        {:else}
          <p>Проверяйте обновления вручную. Установка начнётся только после подтверждения.</p>
        {/if}
      {/if}
      {#if errorMessage && updateStatus.status !== 'error'}
        <p class="error" role="alert">{errorMessage}</p>
      {/if}
      <div class="actions">
        {#if !appInfo || appInfo.updatesSupported}
          {#if updateStatus.status === 'available'}
            <button type="button" class="btn primary" onclick={() => void downloadUpdate()}>Загрузить</button>
          {:else if updateStatus.status === 'downloaded'}
            <button type="button" class="btn primary" onclick={() => void installUpdate()}>Перезапустить и установить</button>
          {:else}
            <button
              type="button"
              class="btn primary"
              disabled={!appInfo || updateStatus.status === 'checking' || updateStatus.status === 'downloading'}
              onclick={() => void checkForUpdates()}
            >Проверить обновления</button>
          {/if}
        {/if}
      </div>
    </section>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 125;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(8px);
  }

  .dialog {
    width: min(460px, 100%);
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
    color: var(--text);
    box-shadow: var(--shadow-md);
  }

  header,
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  header { margin-bottom: 20px; }
  h2, h3, p { margin: 0; }
  h2 { font-size: 16px; }
  h3 { margin-bottom: 8px; font-size: 14px; }
  .eyebrow { margin-bottom: 5px; color: var(--text-dim); font-size: 11px; letter-spacing: 0.12em; }
  .version { margin-bottom: 20px; color: var(--text-dim); }
  section { display: grid; gap: 12px; }
  .actions { justify-content: flex-end; margin-top: 4px; }
  progress { width: 100%; }
  .error { color: var(--danger, #f66); }
  .primary { border-color: var(--accent); background: var(--accent); color: var(--bg); }
</style>
