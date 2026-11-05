import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  AUTOSAVE_DATABASE_VERSION,
  AUTOSAVE_OBJECT_STORE,
  AutosaveRepository,
  writeBlobToFile,
  type SaveFileHandle,
} from './autosave';
import { parseProject, type ProjectData } from './project';
import { AUTOSAVE_BACKUP_KEY, AUTOSAVE_KEY, type KeyValueStorage } from './storage';

function memoryStorage(): KeyValueStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

function project(color: number): ProjectData {
  return {
    width: 2,
    height: 1,
    pixels: new Uint8ClampedArray([color, 2, 3, 255, 0, 0, 0, 0]),
    paletteId: 'pico8',
    freeColor: false,
    primary: { r: 255, g: 0, b: 77, a: 255 },
    secondary: { r: 255, g: 241, b: 232, a: 255 },
    recent: [],
  };
}

let databaseId = 0;
const repository = (storage: KeyValueStorage | null) =>
  new AutosaveRepository(new IDBFactory(), storage, `pixel-editor-test-${databaseId++}`);

describe('IndexedDB autosave repository', () => {
  it('writes the blob to the file selected by the user', async () => {
    const write = vi.fn(async (_blob: Blob) => {});
    const close = vi.fn(async () => {});
    const file: SaveFileHandle = {
      createWritable: vi.fn(async () => ({ write, close })),
    };

    await writeBlobToFile(file, new Blob(['project']));

    expect(file.createWritable).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('aborts the selected file if writing fails', async () => {
    const abort = vi.fn(async () => {});
    const file: SaveFileHandle = {
      createWritable: async () => ({
        write: async () => {
          throw new Error('disk full');
        },
        close: async () => {},
        abort,
      }),
    };

    await expect(writeBlobToFile(file, new Blob(['image']))).rejects.toThrow('disk full');
    expect(abort).toHaveBeenCalledOnce();
  });

  it('removes previously remembered save-directory handles during database upgrade', async () => {
    const factory = new IDBFactory();
    const databaseName = `pixel-editor-legacy-${databaseId++}`;
    const oldDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(AUTOSAVE_OBJECT_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = oldDatabase.transaction(AUTOSAVE_OBJECT_STORE, 'readwrite');
      transaction.objectStore(AUTOSAVE_OBJECT_STORE).put({ obsolete: true }, 'save-directory');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    oldDatabase.close();

    const repo = new AutosaveRepository(factory, null, databaseName);
    expect((await repo.load()).mode).toBe('indexeddb');
    expect(AUTOSAVE_DATABASE_VERSION).toBe(2);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(databaseName, AUTOSAVE_DATABASE_VERSION);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const savedHandle = await new Promise((resolve, reject) => {
      const request = database.transaction(AUTOSAVE_OBJECT_STORE, 'readonly').objectStore(AUTOSAVE_OBJECT_STORE).get('save-directory');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    expect(savedHandle).toBeUndefined();
  });

  it('saves and restores project data with a read-after-write verification', async () => {
    const repo = repository(null);
    expect(await repo.save(project(42))).toBe('indexeddb');

    const startup = await repo.load();
    expect(startup).toMatchObject({ error: null, mode: 'indexeddb' });
    expect(startup.project?.pixels).toEqual(project(42).pixels);
  });

  it('migrates valid localStorage autosave and removes it only after verification', async () => {
    const legacy = memoryStorage();
    const original = JSON.stringify({
      format: 'pixel-editor-project',
      version: 1,
      savedAt: '2026-01-01T00:00:00.000Z',
      width: 2,
      height: 1,
      pixels: 'KgID/wAAAAA=',
      palette: { id: 'pico8', freeColor: false },
      colors: { primary: [255, 0, 77, 255], secondary: [255, 241, 232, 255] },
      recent: [],
    });
    const valid = parseProject(original);
    legacy.setItem(AUTOSAVE_KEY, original);
    const repo = repository(legacy);

    const startup = await repo.load();

    expect(startup.project?.pixels).toEqual(valid.pixels);
    expect(startup.mode).toBe('indexeddb');
    expect(legacy.getItem(AUTOSAVE_KEY)).toBeNull();
    expect((await repo.load()).project?.pixels).toEqual(valid.pixels);
  });

  it('keeps damaged legacy data and writes a separate recovery copy', async () => {
    const legacy = memoryStorage();
    const damaged = '{"format":"pixel-editor-project"';
    legacy.setItem(AUTOSAVE_KEY, damaged);

    const startup = await repository(legacy).load();

    expect(startup.project).toBeNull();
    expect(startup.error).toMatch(/повреждены/);
    expect(legacy.getItem(AUTOSAVE_KEY)).toBe(damaged);
    expect(legacy.getItem(AUTOSAVE_BACKUP_KEY)).toBe(damaged);
  });

  it('uses localStorage explicitly as a fallback when IndexedDB is unavailable', async () => {
    const legacy = memoryStorage();
    const repo = new AutosaveRepository(null, legacy);

    expect(await repo.save(project(56))).toBe('localstorage');
    expect((await repo.load()).project?.pixels).toEqual(project(56).pixels);
    expect(repo.canPersist).toBe(true);
  });

  it('reports failure when no persistence backend is available', async () => {
    const repo = new AutosaveRepository(null, null);
    expect(repo.canPersist).toBe(false);
    await expect(repo.save(project(1))).rejects.toThrow(/недоступно/);
    expect(await repo.load()).toMatchObject({ project: null, mode: 'unavailable' });
  });

  it('does not leave startup stuck when opening IndexedDB never completes', async () => {
    vi.useFakeTimers();
    const request = {
      result: {},
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
    };
    const factory = { open: vi.fn(() => request) } as unknown as IDBFactory;
    const repo = new AutosaveRepository(factory, null);

    try {
      const startup = repo.load();
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(startup).resolves.toMatchObject({
        project: null,
        mode: 'unavailable',
        error: expect.stringContaining('слишком много времени'),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('serializes overlapping writes so the newest project remains saved', async () => {
    const repo = repository(null);
    await Promise.all([repo.save(project(10)), repo.save(project(20))]);
    expect((await repo.load()).project?.pixels[0]).toBe(20);
  });
});
