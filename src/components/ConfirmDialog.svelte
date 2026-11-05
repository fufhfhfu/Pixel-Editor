<script lang="ts">
  import { trapFocus } from './focusTrap';

  interface Props {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onconfirm: () => void;
    oncancel: () => void;
  }

  let { title, message, confirmText = 'Подтвердить', cancelText = 'Отмена', onconfirm, oncancel }: Props = $props();

  let confirmButton: HTMLButtonElement | undefined = $state();

  $effect(() => {
    confirmButton?.focus();
  });

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      oncancel();
    }
  }

  function onBackdropMousedown(e: MouseEvent): void {
    if (e.target === e.currentTarget) oncancel();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="backdrop" role="presentation" onmousedown={onBackdropMousedown}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text" use:trapFocus>
    <h2 id="confirm-title">{title}</h2>
    <p id="confirm-text">{message}</p>
    <div class="actions">
      <button type="button" class="btn" onclick={oncancel}>{cancelText}</button>
      <button type="button" class="btn primary" bind:this={confirmButton} onclick={onconfirm}>
        {confirmText}
      </button>
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
    background: rgba(5, 6, 10, 0.65);
    backdrop-filter: blur(2px);
  }

  .dialog {
    width: min(420px, calc(100vw - 32px));
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  }

  h2 {
    margin: 0 0 8px;
    font-size: 16px;
    font-weight: 600;
  }

  p {
    margin: 0 0 20px;
    color: var(--text-dim);
    line-height: 1.5;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
