import { parseProject, serializeProject, type ProjectData } from './project';
import {
  AUTOSAVE_BACKUP_KEY,
  AUTOSAVE_KEY,
  loadAutosave,
  type KeyValueStorage,
} from './storage';

export const AUTOSAVE_DATABASE_NAME = 'pixel-editor';
export const AUTOSAVE_DATABASE_VERSION = 2;
export const AUTOSAVE_OBJECT_STORE = 'projects';
const AUTOSAVE_RECORD_KEY = 'latest';
const IDB_OPERATION_TIMEOUT_MS = 10_000;

export interface SaveFileHandle {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  }>;
}

interface SavePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<SaveFileHandle>;
}

export type AutosaveStorageMode = 'indexeddb' | 'localstorage' | 'unavailable';

export interface AutosaveStartupResult {
  project: ProjectData | null;
  error: string | null;
  mode: AutosaveStorageMode;
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, AUTOSAVE_DATABASE_VERSION);
    let settled = false;
    const timeout = setTimeout(() => {
      finishWithError(new Error('Открытие IndexedDB заняло слишком много времени.'));
    }, IDB_OPERATION_TIMEOUT_MS);
    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (!database.objectStoreNames.contains(AUTOSAVE_OBJECT_STORE)) {
        database.createObjectStore(AUTOSAVE_OBJECT_STORE);
      }
      if (event.oldVersion < 2) {
        request.transaction?.objectStore(AUTOSAVE_OBJECT_STORE).delete('save-directory');
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      finishWithError(request.error ?? new Error('Не удалось открыть IndexedDB.'));
    };
    request.onblocked = () => {
      finishWithError(new Error('Открытие IndexedDB заблокировано другой вкладкой.'));
    };
  });
}

function readRecord(database: IDBDatabase): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(AUTOSAVE_OBJECT_STORE, 'readonly');
    const request = transaction.objectStore(AUTOSAVE_OBJECT_STORE).get(AUTOSAVE_RECORD_KEY);
    let value: string | null = null;
    let settled = false;
    const timeout = setTimeout(() => {
      transaction.abort();
      finishWithError(new Error('Чтение проекта из IndexedDB заняло слишком много времени.'));
    }, IDB_OPERATION_TIMEOUT_MS);
    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    const finishSuccessfully = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    request.onsuccess = () => {
      if (typeof request.result === 'string') value = request.result;
    };
    transaction.oncomplete = finishSuccessfully;
    transaction.onerror = () => finishWithError(transaction.error ?? new Error('Не удалось прочитать IndexedDB.'));
    transaction.onabort = () => finishWithError(transaction.error ?? new Error('Чтение IndexedDB отменено.'));
  });
}

function writeRecord(database: IDBDatabase, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(AUTOSAVE_OBJECT_STORE, 'readwrite');
    transaction.objectStore(AUTOSAVE_OBJECT_STORE).put(value, AUTOSAVE_RECORD_KEY);
    let settled = false;
    const timeout = setTimeout(() => {
      transaction.abort();
      finishWithError(new Error('Сохранение проекта в IndexedDB заняло слишком много времени.'));
    }, IDB_OPERATION_TIMEOUT_MS);
    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    transaction.onerror = () => finishWithError(transaction.error ?? new Error('Не удалось записать IndexedDB.'));
    transaction.onabort = () => finishWithError(transaction.error ?? new Error('Запись IndexedDB отменена.'));
  });
}

function saveBrokenCopy(storage: KeyValueStorage | null, value: string): string {
  if (!storage) return ' Не удалось сохранить резервную копию повреждённых данных.';
  try {
    storage.setItem(AUTOSAVE_BACKUP_KEY, value);
    return ' Копия исходных данных сохранена отдельно.';
  } catch {
    return ' Не удалось сохранить резервную копию повреждённых данных.';
  }
}

function readLegacyAutosave(storage: KeyValueStorage | null): { raw: string | null; result: ReturnType<typeof loadAutosave> } {
  if (!storage) return { raw: null, result: { project: null, error: null } };
  let raw: string | null;
  try {
    raw = storage.getItem(AUTOSAVE_KEY);
  } catch {
    return {
      raw: null,
      result: { project: null, error: 'Автосохранение недоступно: браузер запретил доступ к localStorage.' },
    };
  }
  if (raw === null) return { raw, result: { project: null, error: null } };
  try {
    return { raw, result: { project: parseProject(raw), error: null } };
  } catch {
    return {
      raw,
      result: {
        project: null,
        error: `Не удалось восстановить автосохранение: данные повреждены.${saveBrokenCopy(storage, raw)}`,
      },
    };
  }
}

export class AutosaveRepository {
  private database: Promise<IDBDatabase> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly factory: IDBFactory | null,
    private readonly legacyStorage: KeyValueStorage | null,
    private readonly databaseName = AUTOSAVE_DATABASE_NAME,
  ) {}

  get canPersist(): boolean {
    return this.factory !== null || this.legacyStorage !== null;
  }

  async load(): Promise<AutosaveStartupResult> {
    if (!this.factory) return this.loadFromLegacy(this.legacyStorage ? 'localstorage' : 'unavailable');

    try {
      const database = await this.getDatabase();
      const saved = await readRecord(database);
      if (saved !== null) {
        try {
          return { project: parseProject(saved), error: null, mode: 'indexeddb' };
        } catch {
          const backupMessage = saveBrokenCopy(this.legacyStorage, saved);
          return {
            project: null,
            error: `Не удалось восстановить автосохранение из IndexedDB: данные повреждены.${backupMessage}`,
            mode: 'indexeddb',
          };
        }
      }

      const legacy = readLegacyAutosave(this.legacyStorage);
      if (!legacy.result.project) {
        return { ...legacy.result, mode: 'indexeddb' };
      }

      try {
        await writeRecord(database, legacy.raw!);
        if ((await readRecord(database)) !== legacy.raw) {
          throw new Error('Проверка записи автосохранения не прошла.');
        }
        try {
          this.legacyStorage?.removeItem(AUTOSAVE_KEY);
        } catch {
          return {
            project: legacy.result.project,
            error: 'Проект перенесён в IndexedDB, но старую копию в localStorage удалить не удалось.',
            mode: 'indexeddb',
          };
        }
        return { project: legacy.result.project, error: null, mode: 'indexeddb' };
      } catch {
        return {
          project: legacy.result.project,
          error: 'Не удалось перенести автосохранение в IndexedDB. Исходная копия в localStorage сохранена.',
          mode: 'localstorage',
        };
      }
    } catch (error) {
      const storageError = error instanceof Error ? error.message : 'не удалось открыть IndexedDB.';
      const legacy = this.loadFromLegacy('localstorage');
      return legacy.project
        ? {
            ...legacy,
            error: `IndexedDB недоступна (${storageError}); открыт резервный проект из localStorage. Новые изменения могут не сохраниться.`,
          }
        : {
            ...legacy,
            mode: 'unavailable',
            error: legacy.error ?? `Автосохранение недоступно: ${storageError}`,
          };
    }
  }

  save(project: ProjectData): Promise<AutosaveStorageMode> {
    const serialized = serializeProject(project);
    const operation = this.writeQueue.then(() => this.saveSerialized(serialized));
    this.writeQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async saveSerialized(serialized: string): Promise<AutosaveStorageMode> {
    if (this.factory) {
      try {
        const database = await this.getDatabase();
        await writeRecord(database, serialized);
        if ((await readRecord(database)) !== serialized) {
          throw new Error('Проверка записи автосохранения не прошла.');
        }
        return 'indexeddb';
      } catch {
        if (this.writeLegacy(serialized)) return 'localstorage';
        throw new Error('Не удалось сохранить проект в IndexedDB или localStorage.');
      }
    }

    if (this.writeLegacy(serialized)) return 'localstorage';
    throw new Error('Автосохранение недоступно: IndexedDB и localStorage не работают.');
  }

  private writeLegacy(serialized: string): boolean {
    try {
      this.legacyStorage?.setItem(AUTOSAVE_KEY, serialized);
      return this.legacyStorage !== null;
    } catch {
      return false;
    }
  }

  private loadFromLegacy(mode: AutosaveStorageMode): AutosaveStartupResult {
    const legacy = readLegacyAutosave(this.legacyStorage);
    return { ...legacy.result, mode };
  }

  private getDatabase(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new Error('IndexedDB недоступна.'));
    this.database ??= openDatabase(this.factory, this.databaseName);
    return this.database;
  }
}

export function supportsSaveFilePicker(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof (window as SavePickerWindow).showSaveFilePicker === 'function';
}

export async function pickSaveFileHandle(
  suggestedName: string,
  mimeType: string,
  extensions: string[],
): Promise<SaveFileHandle | null> {
  if (!supportsSaveFilePicker()) return null;
  try {
    return await (window as SavePickerWindow).showSaveFilePicker!({
      suggestedName,
      types: [{ description: mimeType, accept: { [mimeType]: extensions } }],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

export async function writeBlobToFile(handle: SaveFileHandle, blob: Blob): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort?.();
    throw error;
  }
}

export function getBrowserIndexedDB(): IDBFactory | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.indexedDB ?? null;
  } catch {
    return null;
  }
}
