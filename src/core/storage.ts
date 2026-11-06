import { parseProject, serializeProject, type ProjectData } from './project';

export const AUTOSAVE_KEY = 'pixel-editor:autosave';
export const AUTOSAVE_BACKUP_KEY = 'pixel-editor:autosave:unreadable';

export type SaveStatus = 'pending' | 'saved' | 'degraded' | 'error' | 'unavailable';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AutosaveLoadResult {
  project: ProjectData | null;
  error: string | null;
}

export function getBrowserStorage(): KeyValueStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadAutosave(storage: KeyValueStorage): AutosaveLoadResult {
  let saved: string | null;
  try {
    saved = storage.getItem(AUTOSAVE_KEY);
  } catch {
    return { project: null, error: 'Автосохранение недоступно: браузер запретил доступ к хранилищу.' };
  }

  if (saved === null) return { project: null, error: null };

  try {
    return { project: parseProject(saved), error: null };
  } catch {
    try {
      storage.setItem(AUTOSAVE_BACKUP_KEY, saved);
    } catch {
      return {
        project: null,
        error: 'Не удалось восстановить автосохранение: данные повреждены, резервную копию сохранить не удалось.',
      };
    }
    return {
      project: null,
      error: 'Не удалось восстановить автосохранение: данные повреждены. Исходная копия сохранена отдельно.',
    };
  }
}

export function saveAutosave(storage: KeyValueStorage, project: ProjectData): boolean {
  try {
    const serialized = serializeProject(project);
    storage.setItem(AUTOSAVE_KEY, serialized);
    return storage.getItem(AUTOSAVE_KEY) === serialized;
  } catch {
    return false;
  }
}
