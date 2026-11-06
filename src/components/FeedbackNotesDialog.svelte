<script lang="ts">
  import { onMount } from 'svelte';
  import { FEEDBACK_NOTE_CATEGORIES, type FeedbackNote, type FeedbackNoteCategory, type FeedbackNoteDraft } from '../core/feedbackNotes';
  import { trapFocus } from './focusTrap';

  interface Props {
    returnFocusTo: HTMLElement | null;
    onclose: () => void;
    onnotify: (message: string, kind: 'info' | 'error') => void;
  }

  type ViewMode = 'list' | 'view' | 'edit';
  type DiscardAction = 'close' | 'cancel' | { select: number };

  let { returnFocusTo, onclose, onnotify }: Props = $props();
  let notes = $state<FeedbackNote[]>([]);
  let selectedNumber = $state<number | null>(null);
  let mode = $state<ViewMode>('list');
  let loading = $state(true);
  let loadError = $state('');
  let message = $state('');
  let discardAction = $state<DiscardAction | null>(null);
  let editingNumber = $state<number | null>(null);
  let title = $state('');
  let category = $state<FeedbackNoteCategory>(FEEDBACK_NOTE_CATEGORIES[0]);
  let description = $state('');
  let baseline = $state<FeedbackNoteDraft | null>(null);
  let closeButton: HTMLButtonElement | undefined = $state();
  let titleInput: HTMLInputElement | undefined = $state();
  const selectedNote = $derived(notes.find((note) => note.number === selectedNumber) ?? null);
  const dirty = $derived(
    baseline !== null &&
      (title !== baseline.title || category !== baseline.category || description !== baseline.description),
  );

  onMount(() => {
    void loadNotes();
  });

  $effect(() => {
    if (mode === 'edit') titleInput?.focus();
    else closeButton?.focus();
  });

  async function loadNotes(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      const desktop = window.pixelEditorDesktop;
      if (!desktop) throw new Error('Заметки доступны в настольной версии Pixel Editor.');
      notes = await desktop.listFeedbackNotes();
      mode = selectedNumber === null ? 'list' : 'view';
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
    }
  }

  function beginNewNote(): void {
    selectedNumber = null;
    editingNumber = null;
    title = '';
    category = FEEDBACK_NOTE_CATEGORIES[0];
    description = '';
    baseline = { title, category, description };
    message = '';
    mode = 'edit';
  }

  function beginEdit(note: FeedbackNote): void {
    editingNumber = note.number;
    title = note.title;
    category = note.category;
    description = note.description;
    baseline = { title, category, description };
    message = '';
    mode = 'edit';
  }

  function resetEditor(): void {
    editingNumber = null;
    baseline = null;
    title = '';
    category = FEEDBACK_NOTE_CATEGORIES[0];
    description = '';
    message = '';
  }

  function requestSelection(number: number): void {
    if (number === selectedNumber && mode === 'view') return;
    if (dirty) {
      discardAction = { select: number };
      return;
    }
    resetEditor();
    selectedNumber = number;
    mode = 'view';
  }

  function requestCancel(): void {
    if (dirty) {
      discardAction = 'cancel';
      return;
    }
    finishCancel();
  }

  function finishCancel(): void {
    resetEditor();
    mode = editingNumber !== null || selectedNumber !== null ? 'view' : 'list';
  }

  function requestClose(): void {
    if (dirty) {
      discardAction = 'close';
      return;
    }
    onclose();
  }

  function confirmDiscard(): void {
    const action = discardAction;
    discardAction = null;
    resetEditor();
    if (action === 'close') {
      onclose();
    } else if (typeof action === 'object' && action !== null) {
      selectedNumber = action.select;
      mode = 'view';
    } else {
      mode = selectedNumber === null ? 'list' : 'view';
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (discardAction !== null) {
      discardAction = null;
      return;
    }
    requestClose();
  }

  function onBackdropMousedown(event: MouseEvent): void {
    if (event.target === event.currentTarget) requestClose();
  }

  async function saveNote(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    message = '';
    const draft: FeedbackNoteDraft = {
      title: title.trim(),
      category,
      description: description.replace(/\r\n?/g, '\n').trim(),
    };
    if (!draft.title || !draft.description) {
      message = 'Укажите название и описание заметки.';
      return;
    }

    try {
      const desktop = window.pixelEditorDesktop;
      if (!desktop) throw new Error('Сохранение заметок недоступно в браузере.');
      const updated = editingNumber === null
        ? await desktop.createFeedbackNote(draft)
        : await desktop.updateFeedbackNote(editingNumber, draft);
      if (editingNumber === null) notes = [...notes, updated];
      else notes = notes.map((note) => note.number === updated.number ? updated : note);
      selectedNumber = updated.number;
      const wasEdit = editingNumber !== null;
      resetEditor();
      mode = 'view';
      const confirmation = wasEdit ? 'Заметка обновлена.' : 'Заметка создана.';
      onnotify(confirmation, 'info');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      onnotify(message, 'error');
    }
  }

  function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('ru-RU') : value;
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="backdrop" role="presentation" onmousedown={onBackdropMousedown}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="notes-title" use:trapFocus={returnFocusTo}>
    <header class="dialog-header">
      <div>
        <p class="eyebrow">ЛОКАЛЬНО НА ЭТОМ УСТРОЙСТВЕ</p>
        <h2 id="notes-title">Заметки обратной связи</h2>
      </div>
      <button type="button" class="btn close" aria-label="Закрыть заметки" bind:this={closeButton} onclick={requestClose}>×</button>
    </header>

    {#if loading}
      <div class="state" role="status">Загрузка заметок…</div>
    {:else if loadError}
      <div class="state error" role="alert">
        <p>{loadError}</p>
        <button type="button" class="btn" onclick={() => void loadNotes()}>Повторить</button>
      </div>
    {:else}
      <div class="workspace">
        <aside class="note-list" aria-label="Список заметок">
          <button type="button" class="btn primary new-note" onclick={beginNewNote}>＋ Новая заметка</button>
          {#if notes.length === 0}
            <p class="empty-list">Пока нет заметок</p>
          {:else}
            <ol>
              {#each notes as note (note.number)}
                <li>
                  <button
                    type="button"
                    class="note-item"
                    class:selected={selectedNumber === note.number}
                    aria-current={selectedNumber === note.number ? 'true' : undefined}
                    onclick={() => requestSelection(note.number)}
                  >
                    <span class="note-title"><span class="note-number">№{note.number}</span> {note.title}</span>
                    <span class="note-meta">{note.category}</span>
                    <time datetime={note.createdAt}>{formatDate(note.createdAt)}</time>
                  </button>
                </li>
              {/each}
            </ol>
          {/if}
          <p class="storage-hint">Все заметки хранятся в одном TXT-файле. Интернет не требуется.</p>
        </aside>

        <main class="note-content">
          {#if mode === 'edit'}
            <form onsubmit={saveNote}>
              <h3>{editingNumber === null ? 'Новая заметка' : `Редактирование заметки №${editingNumber}`}</h3>
              <label for="feedback-title">Название</label>
              <input id="feedback-title" bind:this={titleInput} bind:value={title} maxlength="200" required />
              <label for="feedback-category">Категория</label>
              <select id="feedback-category" bind:value={category}>
                {#each FEEDBACK_NOTE_CATEGORIES as option (option)}
                  <option value={option}>{option}</option>
                {/each}
              </select>
              <label for="feedback-description">Описание</label>
              <textarea id="feedback-description" bind:value={description} maxlength="50000" required rows="8"></textarea>
              {#if message}<p class="form-message" role="alert">{message}</p>{/if}
              <div class="actions">
                <button type="button" class="btn" onclick={requestCancel}>Отмена</button>
                <button type="submit" class="btn primary">Сохранить</button>
              </div>
            </form>
          {:else if mode === 'view' && selectedNote}
            <article>
              <div class="note-heading">
                <div>
                  <p class="eyebrow">ЗАМЕТКА №{selectedNote.number} · {selectedNote.category}</p>
                  <h3>{selectedNote.title}</h3>
                </div>
                <button type="button" class="btn" onclick={() => beginEdit(selectedNote)}>Редактировать</button>
              </div>
              <dl class="dates">
                <div><dt>Создана</dt><dd><time datetime={selectedNote.createdAt}>{formatDate(selectedNote.createdAt)}</time></dd></div>
                <div><dt>Изменена</dt><dd><time datetime={selectedNote.updatedAt}>{formatDate(selectedNote.updatedAt)}</time></dd></div>
              </dl>
              <h4>Описание</h4>
              <p class="description">{selectedNote.description}</p>
            </article>
          {:else if notes.length === 0}
            <div class="empty-state">
              <div class="empty-icon" aria-hidden="true">✎</div>
              <h3>Заметок пока нет</h3>
              <p>Сохраните первую ошибку, идею или пожелание — запись останется на этом устройстве.</p>
              <button type="button" class="btn primary" onclick={beginNewNote}>Создать первую заметку</button>
            </div>
          {:else}
            <div class="empty-state"><p>Выберите заметку слева или создайте новую.</p></div>
          {/if}
        </main>
      </div>
    {/if}

    {#if discardAction !== null}
      <div class="discard-confirm" role="alertdialog" aria-labelledby="discard-title" aria-describedby="discard-text">
        <div>
          <h3 id="discard-title">Не сохранённые изменения</h3>
          <p id="discard-text">Изменения будут потеряны. Продолжить без сохранения?</p>
        </div>
        <div class="actions">
          <button type="button" class="btn" onclick={() => (discardAction = null)}>Продолжить редактирование</button>
          <button type="button" class="btn danger" onclick={confirmDiscard}>Не сохранять</button>
        </div>
      </div>
    {/if}
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
    background: rgba(5, 6, 10, 0.68);
    backdrop-filter: blur(3px);
  }

  .dialog {
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(960px, 100%);
    max-height: min(740px, 100%);
    min-height: min(500px, 100%);
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--panel);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  }

  .dialog-header {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 18px 22px;
    border-bottom: 1px solid var(--border);
  }

  h2, h3, h4, p { margin-top: 0; }
  h2 { margin-bottom: 0; font-size: 17px; }
  h3 { margin-bottom: 18px; font-size: 16px; }
  h4 { margin: 22px 0 8px; font-size: 12px; }
  .eyebrow { margin: 0 0 4px; color: var(--text-dim); font-size: 10px; font-weight: 600; letter-spacing: 0.08em; }
  .close { width: 32px; height: 32px; padding: 0; font-size: 22px; }

  .workspace {
    display: grid;
    flex: 1;
    min-height: 0;
    grid-template-columns: minmax(210px, 30%) minmax(0, 1fr);
  }

  .note-list {
    display: flex;
    min-height: 0;
    flex-direction: column;
    padding: 14px;
    border-right: 1px solid var(--border);
    background: var(--bg);
  }

  .new-note { justify-content: center; flex: none; }
  ol { display: grid; gap: 5px; overflow-y: auto; margin: 12px -4px; padding: 0 4px; list-style: none; }
  .note-item {
    display: grid;
    width: 100%;
    gap: 4px;
    padding: 9px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .note-item:hover { background: var(--panel-2); }
  .note-item.selected { border-color: var(--accent); background: var(--accent-soft); }
  .note-title { overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .note-number { color: var(--accent); font-family: var(--mono); font-size: 11px; }
  .note-meta, time, .storage-hint { color: var(--text-dim); font-size: 11px; }
  .storage-hint { margin: auto 0 0; padding-top: 12px; line-height: 1.5; }
  .empty-list { margin: 18px 4px; color: var(--text-dim); text-align: center; }

  .note-content { min-width: 0; overflow-y: auto; padding: 22px; }
  .note-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
  .note-heading h3 { margin: 0; overflow-wrap: anywhere; }
  .dates { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 18px 0 0; }
  .dates div { display: grid; gap: 4px; }
  dt { color: var(--text-dim); font-size: 11px; }
  dd { margin: 0; }
  .description { min-height: 90px; margin: 0; line-height: 1.6; overflow-wrap: anywhere; white-space: pre-wrap; }

  form { display: grid; gap: 8px; max-width: 640px; }
  form h3 { margin-bottom: 8px; }
  form label { margin-top: 4px; color: var(--text-dim); font-size: 12px; }
  input, select, textarea {
    width: 100%;
    min-height: 36px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  textarea { min-height: 150px; resize: vertical; line-height: 1.5; }
  .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  .form-message, .error { color: #ff7777; }
  .state { display: grid; flex: 1; place-content: center; justify-items: center; gap: 12px; padding: 24px; color: var(--text-dim); text-align: center; }
  .state p { max-width: 560px; line-height: 1.5; }
  .empty-state { display: grid; min-height: 100%; align-content: center; justify-items: center; gap: 10px; text-align: center; }
  .empty-state p { max-width: 380px; margin-bottom: 8px; color: var(--text-dim); line-height: 1.5; }
  .empty-state h3 { margin: 0; }
  .empty-icon { display: grid; width: 46px; height: 46px; place-items: center; border-radius: 14px; background: var(--accent-soft); color: var(--accent); font-size: 24px; }
  .discard-confirm {
    position: absolute;
    z-index: 1;
    inset: auto 16px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel-2);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  }
  .discard-confirm h3 { margin: 0 0 4px; font-size: 13px; }
  .discard-confirm p { margin: 0; color: var(--text-dim); line-height: 1.4; }
  .discard-confirm .actions { flex: none; margin: 0; }
  .danger { border-color: #9c4545; color: #ffaaaa; }

  @media (max-width: 620px) {
    .backdrop { padding: 8px; }
    .dialog { min-height: 0; }
    .workspace { grid-template-columns: minmax(120px, 35%) minmax(0, 1fr); }
    .dialog-header { padding: 14px; }
    .note-list { padding: 8px; }
    .note-content { padding: 14px; }
    .note-heading { flex-direction: column; }
    .discard-confirm { align-items: stretch; flex-direction: column; }
    .discard-confirm .actions { justify-content: stretch; }
    .discard-confirm .btn { flex: 1; }
  }
</style>
