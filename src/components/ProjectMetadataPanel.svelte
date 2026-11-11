<script lang="ts">
  import {
    parseProjectMetadataJson,
    type ProjectMetadata,
  } from '../core/project';

  interface Props {
    metadata: ProjectMetadata;
    onapply: (metadata: ProjectMetadata) => void;
  }

  let { metadata, onapply }: Props = $props();
  let draft = $state('{}');
  let error = $state('');

  $effect(() => {
    draft = JSON.stringify(metadata, null, 2);
    error = '';
  });

  function apply(): void {
    try {
      onapply(parseProjectMetadataJson(draft));
      error = '';
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
  }
</script>

<section class="metadata-panel" aria-label="Метаданные проекта">
  <h2>Метаданные проекта</h2>
  <p>Дополнительные данные сохраняются в JSON-файле проекта.</p>
  <label for="project-metadata">JSON-объект</label>
  <textarea id="project-metadata" bind:value={draft} rows="8" spellcheck="false"></textarea>
  <button type="button" onclick={apply}>Применить метаданные</button>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .metadata-panel {
    display: grid;
    gap: 8px;
    margin-top: 16px;
  }

  h2 {
    margin: 0;
    font-size: 13px;
  }

  p,
  label {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font: 11px var(--mono);
  }

  button {
    min-height: 30px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel-2);
    color: var(--text);
    cursor: pointer;
  }

  .error {
    color: var(--danger, #f66);
  }
</style>
