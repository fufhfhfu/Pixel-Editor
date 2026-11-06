import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createFeedbackNotesStore } = require('../../electron/feedbackNotes.cjs') as {
  createFeedbackNotesStore: (directory: string, options?: Record<string, unknown>) => {
    list: () => Promise<Array<{
      number: number;
      title: string;
      category: string;
      description: string;
      createdAt: string;
      updatedAt: string;
    }>>;
    create: (draft: { title: string; category: string; description: string }) => Promise<unknown>;
    update: (number: number, draft: { title: string; category: string; description: string }) => Promise<unknown>;
  };
};

const directories: string[] = [];

async function createStore(options?: Record<string, unknown>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pixel-editor-notes-'));
  directories.push(directory);
  return { directory, store: createFeedbackNotesStore(directory, options) };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('локальные заметки обратной связи', () => {
  it('создаёт один UTF-8 TXT с последовательными номерами, кириллицей и многострочным текстом', async () => {
    const { directory, store } = await createStore({
      now: (() => {
        let milliseconds = Date.parse('2026-11-07T02:00:00.000Z');
        return () => new Date(milliseconds += 60_000);
      })(),
      makeId: () => 'temporary',
    });

    expect(await store.list()).toEqual([]);
    expect(await readdir(directory)).toEqual([]);

    const first = await store.create({
      title: 'Ошибка: «Сохранение» ✓',
      category: 'Ошибка / баг',
      description: 'Первая строка\nВторая строка с ёлочными кавычками «» и emoji 🎨',
    });
    const second = await store.create({
      title: 'Новая функция',
      category: 'Новая функция',
      description: 'Описание',
    });

    expect(await store.list()).toEqual([first, second]);
    expect((first as { number: number }).number).toBe(1);
    expect((second as { number: number }).number).toBe(2);
    expect(await readdir(directory)).toEqual(['feedback-notes.txt']);
    const contents = await readFile(path.join(directory, 'feedback-notes.txt'));
    expect(contents.toString('utf8')).toContain('Ошибка:');
    expect(contents.toString('utf8')).toContain('Первая строка\\nВторая строка');
  });

  it('обновляет выбранную заметку, сохраняя её номер, дату создания и остальные записи', async () => {
    let milliseconds = Date.parse('2026-11-07T02:00:00.000Z');
    const { store } = await createStore({ now: () => new Date(milliseconds += 60_000) });
    const first = await store.create({ title: 'Первая', category: 'Другое', description: 'Исходный текст' }) as {
      number: number;
      createdAt: string;
      updatedAt: string;
    };
    const second = await store.create({ title: 'Вторая', category: 'Новая функция', description: 'Без изменений' });

    const updated = await store.update(1, {
      title: 'Исправленная первая',
      category: 'Улучшение существующего функционала',
      description: 'Новый текст\nсо второй строкой',
    }) as { number: number; createdAt: string; updatedAt: string; title: string };

    expect(updated).toMatchObject({
      number: 1,
      createdAt: first.createdAt,
      updatedAt: new Date(milliseconds).toISOString(),
      title: 'Исправленная первая',
    });
    expect(await store.list()).toEqual([updated, second]);
  });

  it('сериализует одновременное создание и сохраняет непрерывную нумерацию', async () => {
    const { store } = await createStore();
    const notes = await Promise.all([
      store.create({ title: 'Первая параллельная', category: 'Другое', description: 'Текст 1' }),
      store.create({ title: 'Вторая параллельная', category: 'Другое', description: 'Текст 2' }),
      store.create({ title: 'Третья параллельная', category: 'Другое', description: 'Текст 3' }),
    ]);

    expect(notes.map((note) => (note as { number: number }).number)).toEqual([1, 2, 3]);
    expect((await store.list()).map((note) => note.number)).toEqual([1, 2, 3]);
  });

  it('не перезаписывает повреждённый или некорректный UTF-8 файл', async () => {
    const { directory, store } = await createStore();
    const file = path.join(directory, 'feedback-notes.txt');
    const damaged = Buffer.from([0xff, 0xfe, 0x00]);
    await writeFile(file, damaged);

    await expect(store.list()).rejects.toThrow(/UTF-8/u);
    await expect(store.create({ title: 'Не добавлять', category: 'Другое', description: 'Текст' }))
      .rejects.toThrow(/UTF-8/u);
    expect(await readFile(file)).toEqual(damaged);
  });

  it('не изменяет читаемый текстовый файл с неизвестной структурой', async () => {
    const { directory, store } = await createStore();
    const file = path.join(directory, 'feedback-notes.txt');
    const damaged = Buffer.from('# Pixel Editor — заметки обратной связи v1\n\nПотенциально важные данные\n', 'utf8');
    await writeFile(file, damaged);

    await expect(store.create({ title: 'Не добавлять', category: 'Другое', description: 'Текст' }))
      .rejects.toThrow(/повреждён/u);
    expect(await readFile(file)).toEqual(damaged);
  });

  it('оставляет исходный файл целым при ошибке атомарной замены', async () => {
    const { directory, store } = await createStore({ now: () => new Date('2026-11-07T02:00:00.000Z') });
    await store.create({ title: 'Сохранённая', category: 'Другое', description: 'Безопасный текст' });
    const file = path.join(directory, 'feedback-notes.txt');
    const original = await readFile(file);
    const nodeFs = await import('node:fs/promises');
    const failingFileSystem = new Proxy(nodeFs, {
      get(target, property) {
        if (property === 'rename') return async () => { throw new Error('simulated replacement failure'); };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const failingStore = createFeedbackNotesStore(directory, { fileSystem: failingFileSystem });

    await expect(failingStore.update(1, {
      title: 'Не сохранится',
      category: 'Другое',
      description: 'Текст',
    })).rejects.toThrow(/Ранее сохранённые данные не изменены/u);
    expect(await readFile(file)).toEqual(original);
    expect(await readdir(directory)).toEqual(['feedback-notes.txt']);
  });

  it('отказывает пустым заметкам и недопустимым номерам', async () => {
    const { store } = await createStore();
    await expect(store.create({ title: '  ', category: 'Другое', description: 'текст' }))
      .rejects.toThrow('Укажите название заметки.');
    await expect(store.create({ title: 'Заметка', category: 'Другое', description: ' \n ' }))
      .rejects.toThrow('Добавьте описание заметки.');
    await expect(store.update(0, { title: 'Заметка', category: 'Другое', description: 'текст' }))
      .rejects.toThrow('Некорректный номер заметки.');
  });
});
