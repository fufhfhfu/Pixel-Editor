<script lang="ts">
  interface Props {
    message: string;
    kind: 'info' | 'error';
    onclose: () => void;
  }

  let { message, kind, onclose }: Props = $props();
</script>

<div class="toast" class:error={kind === 'error'} role={kind === 'error' ? 'alert' : 'status'}>
  <span class="text">{message}</span>
  <button type="button" class="close" aria-label="Закрыть" onclick={onclose}>×</button>
</div>

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(44px + env(safe-area-inset-bottom, 0px));
    z-index: 90;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: min(520px, calc(100vw - 32px));
    padding: 10px 12px 10px 16px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius);
    background: var(--panel-raised);
    box-shadow: var(--shadow-md);
    transform: translateX(-50%);
    line-height: 1.4;
  }

  .toast.error {
    border-left-color: var(--danger);
  }

  .text {
    flex: 1;
  }

  .close {
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-dim);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  .close:hover {
    background: var(--panel-2);
    color: var(--text);
  }
</style>
