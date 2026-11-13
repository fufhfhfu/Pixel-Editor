import { describe, expect, it } from 'vitest';
import { MAX_NOTES_IMPORT_BYTES, parseNotesImport, parseNotesImportDocument } from './notesImport';

describe('notes import', () => {
  it('imports plain text and Markdown without modifying their contents', () => {
    const markdown = '# Sketch\n\n- Try a warmer palette\n';
    expect(parseNotesImport('ideas.md', markdown)).toBe(markdown);
    expect(parseNotesImport('ideas.markdown', markdown)).toBe(markdown);
    expect(parseNotesImport('ideas.txt', 'Keep this text\n')).toBe('Keep this text\n');
  });

  it('imports the editor JSON format and compatible notes objects', () => {
    expect(parseNotesImport('notes.json', JSON.stringify({
      format: 'pixel-editor-notes',
      version: 1,
      notes: 'Saved notes',
    }))).toBe('Saved notes');
    expect(parseNotesImport('notes.json', JSON.stringify({ notes: 'Imported notes' }))).toBe('Imported notes');
  });

  it('preserves note title and timestamps from exported JSON', () => {
    expect(parseNotesImportDocument('notes.json', JSON.stringify({
      format: 'pixel-editor-notes',
      version: 1,
      title: 'Planning',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
      notes: 'Saved notes',
    }))).toEqual({
      title: 'Planning',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
      notes: 'Saved notes',
    });
    expect(() => parseNotesImportDocument('notes.json', JSON.stringify({
      notes: 'Invalid dates',
      createdAt: 10,
      updatedAt: 9,
    }))).toThrow(/некорректные даты/i);
  });

  it('rejects unsupported extensions and malformed or incompatible JSON', () => {
    expect(() => parseNotesImport('notes.pdf', 'text')).toThrow(/поддерживаются/i);
    expect(() => parseNotesImport('notes.json', '{')).toThrow(/некорректный JSON/i);
    expect(() => parseNotesImport('notes.json', '[]')).toThrow(/должен быть объектом/i);
    expect(() => parseNotesImport('notes.json', '{"format":"other","notes":"text"}')).toThrow(/не поддерживается/i);
    expect(() => parseNotesImport('notes.json', '{"format":"pixel-editor-notes","version":2,"notes":"text"}'))
      .toThrow(/версия.*не поддерживается/i);
    expect(() => parseNotesImport('notes.json', '{"notes":1}')).toThrow(/текстовое поле notes/i);
  });

  it('sets a bounded file size limit suitable for project notes', () => {
    expect(MAX_NOTES_IMPORT_BYTES).toBe(5 * 1024 * 1024);
  });
});
