import { describe, expect, it } from 'vitest';
import {
  CANVAS_BACKGROUND_KEY,
  CUSTOM_SIZES_KEY,
  DEFAULT_CANVAS_BACKGROUND,
  DEFAULT_WORKSPACE_BACKGROUND,
  loadEditorPreferences,
  saveCanvasBackground,
  saveCustomSizes,
  saveThemePreference,
  THEME_KEY,
  saveWorkspaceBackground,
  WORKSPACE_BACKGROUND_KEY,
} from './preferences';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe('пользовательские настройки холста', () => {
  it('сохраняет и загружает пользовательские размеры и цвет фона', () => {
    const storage = memoryStorage();
    const sizes = [{ width: 128, height: 192 }, { width: 48, height: 48 }];

    expect(saveCustomSizes(storage, sizes)).toBe(true);
    expect(saveCanvasBackground(storage, '#aabbcc')).toBe(true);
    expect(loadEditorPreferences(storage)).toEqual({
      customSizes: sizes,
      canvasBackground: '#aabbcc',
      workspaceBackground: DEFAULT_WORKSPACE_BACKGROUND,
      theme: 'dark',
      error: null,
    });
  });

  it('stores canvas and surrounding workspace backgrounds independently', () => {
    const storage = memoryStorage();
    expect(saveCanvasBackground(storage, '#aabbcc')).toBe(true);
    expect(saveWorkspaceBackground(storage, '#112233')).toBe(true);

    expect(loadEditorPreferences(storage)).toMatchObject({
      canvasBackground: '#aabbcc',
      workspaceBackground: '#112233',
    });
    expect(storage.getItem(WORKSPACE_BACKGROUND_KEY)).toBe('#112233');
  });

  it('сохраняет выбор системной, тёмной и светлой темы', () => {
    const storage = memoryStorage();

    expect(saveThemePreference(storage, 'system')).toBe(true);
    expect(loadEditorPreferences(storage).theme).toBe('system');
    expect(saveThemePreference(storage, 'light')).toBe(true);
    expect(loadEditorPreferences(storage).theme).toBe('light');
    expect(saveThemePreference(storage, 'dark')).toBe(true);
    expect(loadEditorPreferences(storage).theme).toBe('dark');
    storage.setItem(THEME_KEY, 'auto');
    expect(loadEditorPreferences(storage).theme).toBe('dark');
  });

  it('не сохраняет встроенные размеры, дубликаты и недопустимые значения', () => {
    const storage = memoryStorage();
    storage.setItem(
      CUSTOM_SIZES_KEY,
      JSON.stringify([
        { width: 16, height: 16 },
        { width: 128, height: 192 },
        { width: 128, height: 192 },
        { width: 4097, height: 10 },
        { width: 3000, height: 2000 },
        null,
      ]),
    );

    expect(loadEditorPreferences(storage).customSizes).toEqual([{ width: 128, height: 192 }]);
  });

  it('использует безопасный фон по умолчанию для некорректного значения', () => {
    const storage = memoryStorage();
    storage.setItem(CANVAS_BACKGROUND_KEY, 'url(javascript:alert(1))');
    expect(loadEditorPreferences(storage).canvasBackground).toBe(DEFAULT_CANVAS_BACKGROUND);
    expect(saveCanvasBackground(storage, 'red')).toBe(false);
  });

  it('сообщает об ошибке чтения, не теряя исходное состояние', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem() {},
      removeItem() {},
    };
    expect(loadEditorPreferences(storage)).toMatchObject({
      customSizes: [],
      canvasBackground: DEFAULT_CANVAS_BACKGROUND,
      workspaceBackground: DEFAULT_WORKSPACE_BACKGROUND,
      theme: 'dark',
      error: expect.stringMatching(/не удалось прочитать/i),
    });
  });
});
