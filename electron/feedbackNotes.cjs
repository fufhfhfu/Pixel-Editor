const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { TextDecoder } = require('node:util');

const HEADER = '# Pixel Editor — заметки обратной связи v1';
const SEPARATOR = '========================================';
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_NOTES = 10_000;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 50_000;
const CATEGORIES = new Set([
  'Ошибка / баг',
  'Новая функция',
  'Улучшение существующего функционала',
  'Другое',
]);

function invalidFile() {
  return new Error('Файл заметок повреждён или имеет неподдерживаемый формат. Исходный файл не изменён.');
}

function isValidTimestamp(value) {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function validateDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new TypeError('Некорректные данные заметки.');
  }
  const title = typeof draft.title === 'string' ? draft.title.trim() : '';
  const description = typeof draft.description === 'string'
    ? draft.description.replace(/\r\n?/g, '\n').trim()
    : '';
  if (!title) throw new TypeError('Укажите название заметки.');
  if (title.length > MAX_TITLE_LENGTH) throw new RangeError(`Название не должно превышать ${MAX_TITLE_LENGTH} символов.`);
  if (!CATEGORIES.has(draft.category)) throw new TypeError('Выберите допустимую категорию заметки.');
  if (!description) throw new TypeError('Добавьте описание заметки.');
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new RangeError(`Описание не должно превышать ${MAX_DESCRIPTION_LENGTH} символов.`);
  }
  return { title, category: draft.category, description };
}

function parseJsonField(line, label) {
  const prefix = `${label}: `;
  if (!line.startsWith(prefix)) throw invalidFile();
  let value;
  try {
    value = JSON.parse(line.slice(prefix.length));
  } catch {
    throw invalidFile();
  }
  if (typeof value !== 'string') throw invalidFile();
  return value;
}

function parseNotes(text) {
  const normalized = text.replace(/^\uFEFF/u, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0] !== HEADER || lines[1] !== '') throw invalidFile();

  const notes = [];
  let index = 2;
  while (index < lines.length) {
    while (lines[index] === '') index++;
    if (index >= lines.length) break;
    if (lines[index] !== SEPARATOR || index + 6 >= lines.length) throw invalidFile();

    const numberMatch = /^ЗАМЕТКА №(\d+)$/u.exec(lines[index + 1]);
    const noteNumber = numberMatch ? Number(numberMatch[1]) : NaN;
    const title = parseJsonField(lines[index + 2], 'Название');
    const category = lines[index + 3].startsWith('Категория: ')
      ? lines[index + 3].slice('Категория: '.length)
      : '';
    const createdAt = lines[index + 4].startsWith('Дата создания: ')
      ? lines[index + 4].slice('Дата создания: '.length)
      : '';
    const updatedAt = lines[index + 5].startsWith('Последнее изменение: ')
      ? lines[index + 5].slice('Последнее изменение: '.length)
      : '';
    const description = parseJsonField(lines[index + 6], 'Описание');

    if (
      noteNumber !== notes.length + 1 ||
      !Number.isSafeInteger(noteNumber) ||
      notes.length >= MAX_NOTES ||
      !CATEGORIES.has(category) ||
      !isValidTimestamp(createdAt) ||
      !isValidTimestamp(updatedAt)
    ) {
      throw invalidFile();
    }

    let validated;
    try {
      validated = validateDraft({ title, category, description });
    } catch {
      throw invalidFile();
    }
    notes.push({ number: noteNumber, ...validated, createdAt, updatedAt });
    index += 7;
  }
  return notes;
}

function serializeNotes(notes) {
  const records = notes.map((note) => [
    SEPARATOR,
    `ЗАМЕТКА №${note.number}`,
    `Название: ${JSON.stringify(note.title)}`,
    `Категория: ${note.category}`,
    `Дата создания: ${note.createdAt}`,
    `Последнее изменение: ${note.updatedAt}`,
    `Описание: ${JSON.stringify(note.description)}`,
  ].join('\n'));
  return `${HEADER}\n\n${records.join('\n\n')}${records.length ? '\n' : ''}`;
}

function createFeedbackNotesStore(directory, options = {}) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new TypeError('Не задан каталог заметок.');
  }
  const fileSystem = options.fileSystem ?? fs;
  const now = options.now ?? (() => new Date());
  const makeId = options.makeId ?? randomUUID;
  const filePath = path.join(directory, 'feedback-notes.txt');
  let mutationTail = Promise.resolve();

  async function readNotes() {
    let contents;
    try {
      contents = await fileSystem.readFile(filePath);
    } catch (error) {
      if (error && error.code === 'ENOENT') return [];
      throw new Error('Не удалось прочитать файл заметок. Проверьте доступ к данным приложения.', { cause: error });
    }
    if (contents.byteLength > MAX_FILE_BYTES) {
      throw new Error('Файл заметок превышает допустимый размер и не был изменён.');
    }
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(contents);
    } catch (error) {
      throw new Error('Файл заметок содержит некорректный UTF-8. Исходный файл не изменён.', { cause: error });
    }
    return parseNotes(text);
  }

  async function writeNotes(notes) {
    try {
      await fileSystem.mkdir(directory, { recursive: true });
      try {
        await fileSystem.access(filePath, constants.W_OK);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
        await fileSystem.access(directory, constants.W_OK);
      }
    } catch (error) {
      throw new Error('Нет доступа для сохранения файла заметок. Проверьте права на каталог данных приложения.', { cause: error });
    }

    const temporaryPath = `${filePath}.${process.pid}.${makeId()}.tmp`;
    let temporaryCreated = false;
    try {
      const handle = await fileSystem.open(temporaryPath, 'wx', 0o600);
      temporaryCreated = true;
      try {
        await handle.writeFile(serializeNotes(notes), { encoding: 'utf8' });
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fileSystem.rename(temporaryPath, filePath);
      temporaryCreated = false;
    } catch (error) {
      if (temporaryCreated) {
        try {
          await fileSystem.unlink(temporaryPath);
        } catch (cleanupError) {
          if (!cleanupError || cleanupError.code !== 'ENOENT') {
            throw new AggregateError(
              [error, cleanupError],
              'Не удалось сохранить заметки или удалить временный файл.',
            );
          }
        }
      }
      throw new Error('Не удалось безопасно сохранить заметки. Ранее сохранённые данные не изменены.', { cause: error });
    }
  }

  function serializeMutation(operation) {
    const result = mutationTail.then(operation);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  return {
    list() {
      return mutationTail.then(readNotes);
    },
    create(draft) {
      return serializeMutation(async () => {
        const validated = validateDraft(draft);
        const notes = await readNotes();
        if (notes.length >= MAX_NOTES) throw new Error('Достигнут лимит заметок.');
        const date = now();
        if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
          throw new Error('Не удалось определить время создания заметки.');
        }
        const note = {
          number: notes.length + 1,
          ...validated,
          createdAt: date.toISOString(),
          updatedAt: date.toISOString(),
        };
        await writeNotes([...notes, note]);
        return note;
      });
    },
    update(number, draft) {
      return serializeMutation(async () => {
        const validated = validateDraft(draft);
        if (!Number.isSafeInteger(number) || number < 1) throw new TypeError('Некорректный номер заметки.');
        const notes = await readNotes();
        const index = notes.findIndex((note) => note.number === number);
        if (index === -1) throw new Error('Заметка не найдена.');
        const date = now();
        if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
          throw new Error('Не удалось определить время изменения заметки.');
        }
        const updated = { ...notes[index], ...validated, updatedAt: date.toISOString() };
        const next = notes.slice();
        next[index] = updated;
        await writeNotes(next);
        return updated;
      });
    },
  };
}

module.exports = { createFeedbackNotesStore, parseNotes, serializeNotes, validateDraft };
