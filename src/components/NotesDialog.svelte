<script lang="ts">
  import { trapFocus } from './focusTrap';

  interface Props {
    value: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    returnFocusTo: HTMLElement | null;
    oninput: (value: string) => void;
    ontitle: (value: string) => void;
    onimport: (file: File) => void;
    onexport: (format: 'markdown' | 'text' | 'json') => void;
    onpdf: () => void;
    status: string;
    onclose: () => void;
  }

  let { value, title, createdAt, updatedAt, returnFocusTo, oninput, ontitle, onimport, onexport, onpdf, status, onclose }: Props = $props();
  let closeButton: HTMLButtonElement | undefined = $state();
  let editor: HTMLTextAreaElement | undefined = $state();
  let format = $state<'markdown' | 'text' | 'json'>('markdown');
  let fileInput: HTMLInputElement | undefined = $state();
  let search = $state('');
  const matchCount = $derived(search.trim() ? value.toLocaleLowerCase().split(search.trim().toLocaleLowerCase()).length - 1 : 0);

  $effect(() => {
    closeButton?.focus();
  });

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
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="notes-title" use:trapFocus={returnFocusTo}>
    <header>
      <div>
        <h2 id="notes-title" class="sr-only">Заметки</h2>
        <input class="title" aria-label="Название заметки" value={title} oninput={(event) => ontitle(event.currentTarget.value)} />
        <p>Идеи, палитры и комментарии к текущему проекту</p>
      </div>
      <button type="button" class="btn" bind:this={closeButton} onclick={onclose}>Закрыть</button>
    </header>

    <textarea
      bind:this={editor}
      class="editor"
      value={value}
      aria-label="Текст заметок"
      placeholder="Введите заметки к проекту…"
      oninput={(event) => oninput(event.currentTarget.value)}
    ></textarea>

    <div class="note-tools">
      <input class="search" type="search" placeholder="Поиск в заметках…" aria-label="Поиск в заметках" bind:value={search} />
      {#if search.trim()}<span>{matchCount} совпадений</span>{/if}
    </div>

    <div class="templates" aria-label="Шаблоны заметок">
      <span>Шаблон:</span>
      <button type="button" class="template" onclick={() => oninput(`${value}${value ? '\n\n' : ''}## Описание\n`)}>Описание</button>
      <button type="button" class="template" onclick={() => oninput(`${value}${value ? '\n\n' : ''}## Задачи\n- [ ] `)}>Задачи</button>
      <button type="button" class="template" onclick={() => oninput(`${value}${value ? '\n\n' : ''}## Палитра\n`)}>Палитра</button>
    </div>

    <footer>
      <span class="meta">{value.length.toLocaleString('ru-RU')} символов · {status}<br />Создано: {new Date(createdAt).toLocaleDateString('ru-RU')} · Изменено: {new Date(updatedAt).toLocaleString('ru-RU')}</span>
      <div class="actions">
        <button type="button" class="btn" onclick={() => fileInput?.click()}>Импортировать</button>
        <button type="button" class="btn" onclick={() => editor?.focus()}>Продолжить редактирование</button>
        <select class="format" aria-label="Формат экспорта заметок" bind:value={format}>
          <option value="markdown">Markdown (.md)</option>
          <option value="text">Текст (.txt)</option>
          <option value="json">JSON (.json)</option>
        </select>
        <button type="button" class="btn primary" onclick={() => onexport(format)} disabled={!value.trim()}>Экспортировать</button>
        <button type="button" class="btn" onclick={onpdf} disabled={!value.trim()}>PDF</button>
      </div>
    </footer>
    <input bind:this={fileInput} class="hidden" type="file" accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/json" onchange={(event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) onimport(file);
    }} />
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
    padding: 16px;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(8px);
  }

  .dialog {
    display: flex;
    flex-direction: column;
    width: min(720px, 100%);
    max-height: min(680px, 100%);
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
    box-shadow: var(--shadow-md), 0 0 0 1px color-mix(in srgb, var(--border) 60%, transparent);
  }

  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  header {
    margin-bottom: 14px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .title {
    width: min(360px, 55vw);
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font-size: 17px;
    font-weight: 650;
  }

  .title:focus {
    border-color: var(--accent);
    outline: 0;
  }

  p {
    margin: 4px 0 0;
    color: var(--text-dim);
    font-size: 12px;
  }

  .editor {
    min-height: 320px;
    resize: vertical;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    outline: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.6 var(--font);
  }

  .editor:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  footer {
    margin-top: 14px;
  }

  .meta {
    color: var(--text-dim);
    font-size: 12px;
  }

  .templates {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
    color: var(--text-dim);
    font-size: 12px;
  }

  .note-tools {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    color: var(--text-dim);
    font-size: 12px;
  }

  .search {
    flex: 1;
    min-width: 0;
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
  }

  .template {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel-2);
    color: var(--text);
    cursor: pointer;
  }

  .template:hover {
    border-color: var(--accent);
  }

  .hidden {
    display: none;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .format {
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text);
  }

  @media (max-width: 560px) {
    .dialog {
      padding: 14px;
    }

    footer {
      align-items: stretch;
      flex-direction: column;
    }

    .actions .btn,
    .actions .format {
      flex: 1;
      justify-content: center;
    }
  }
</style>
