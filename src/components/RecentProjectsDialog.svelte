<script lang="ts">
  import { trapFocus } from './focusTrap';

  interface Props {
    projects: readonly DesktopRecentProject[];
    onselect: (id: string) => void;
    onclose: () => void;
  }

  let { projects, onselect, onclose }: Props = $props();
  let closeButton: HTMLButtonElement | undefined = $state();

  $effect(() => closeButton?.focus());

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
  <dialog open class="dialog" aria-modal="true" aria-labelledby="recent-projects-title" use:trapFocus>
    <header>
      <h2 id="recent-projects-title">Недавние проекты</h2>
      <button bind:this={closeButton} type="button" class="btn close" aria-label="Закрыть" onclick={onclose}>×</button>
    </header>
    {#if projects.length === 0}
      <p class="empty">Недавних проектов пока нет.</p>
    {:else}
      <ul>
        {#each projects as project (project.id)}
          <li>
            <button type="button" class="project" onclick={() => onselect(project.id)}>
              <span class="file-name">{project.fileName}</span>
              <span class="open-label">Открыть</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <footer><button type="button" class="btn" onclick={onclose}>Закрыть</button></footer>
  </dialog>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 125;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(8px);
  }

  .dialog {
    width: min(460px, calc(100vw - 32px));
    max-height: min(620px, calc(100vh - 32px));
    display: flex;
    flex-direction: column;
    padding: 18px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
    box-shadow: var(--shadow-md);
  }

  header, footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  h2 { margin: 0; font-size: 16px; }
  .close { width: 32px; min-width: 32px; padding: 0; font-size: 20px; }
  ul { display: grid; gap: 6px; overflow: auto; margin: 16px 0; padding: 0; list-style: none; }
  .project {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text);
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .project:hover { border-color: var(--accent); }
  .file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .open-label, .empty { color: var(--text-dim); }
  .empty { margin: 24px 0; }
  footer { justify-content: flex-end; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
