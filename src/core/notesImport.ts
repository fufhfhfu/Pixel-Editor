export const MAX_NOTES_IMPORT_BYTES = 5 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'json']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseNotesImport(fileName: string, content: string): string {
  const extension = fileName.split('.').at(-1)?.toLowerCase();
  if (!extension || !SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('Поддерживаются заметки TXT, Markdown и JSON.');
  }
  if (extension !== 'json') return content;

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
  return parsed.notes;
}
