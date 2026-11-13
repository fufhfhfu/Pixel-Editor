export const MAX_NOTES_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_NOTES_TITLE_LENGTH = 200;

const SUPPORTED_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'json']);

export interface ImportedProjectNotes {
  notes: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseNotesImport(fileName: string, content: string): string {
  return parseNotesImportDocument(fileName, content).notes;
}

export function parseNotesImportDocument(fileName: string, content: string): ImportedProjectNotes {
  const extension = fileName.split('.').at(-1)?.toLowerCase();
  if (!extension || !SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('Поддерживаются заметки TXT, Markdown и JSON.');
  }
  if (extension !== 'json') return { notes: content };

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Файл заметок содержит некорректный JSON.');
  }
  if (!isRecord(parsed)) throw new Error('JSON заметок должен быть объектом.');
  if (parsed.format !== undefined && parsed.format !== 'pixel-editor-notes') {
    throw new Error('Формат JSON-файла заметок не поддерживается.');
  }
  if (parsed.version !== undefined && parsed.version !== 1) {
    throw new Error('Версия JSON-файла заметок не поддерживается.');
  }
  if (typeof parsed.notes !== 'string') {
    throw new Error('В JSON не найдено текстовое поле notes.');
  }
  const result: ImportedProjectNotes = { notes: parsed.notes };
  if (parsed.title !== undefined) {
    if (typeof parsed.title !== 'string' || parsed.title.length > MAX_NOTES_TITLE_LENGTH) {
      throw new Error('В JSON заметок указано некорректное название.');
    }
    result.title = parsed.title;
  }
  if (parsed.createdAt !== undefined || parsed.updatedAt !== undefined) {
    if (
      !Number.isSafeInteger(parsed.createdAt) ||
      !Number.isSafeInteger(parsed.updatedAt) ||
      (parsed.createdAt as number) < 0 ||
      (parsed.updatedAt as number) < (parsed.createdAt as number) ||
      !Number.isFinite(new Date(parsed.createdAt as number).getTime()) ||
      !Number.isFinite(new Date(parsed.updatedAt as number).getTime())
    ) {
      throw new Error('В JSON заметок указаны некорректные даты.');
    }
    result.createdAt = parsed.createdAt as number;
    result.updatedAt = parsed.updatedAt as number;
  }
  return result;
}
