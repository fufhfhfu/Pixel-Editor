import { GRID_PRESETS, isValidCanvasSize } from './state';

export const CUSTOM_SIZES_KEY = 'pixel-editor:custom-sizes';
export const CANVAS_BACKGROUND_KEY = 'pixel-editor:canvas-background';
export const WORKSPACE_BACKGROUND_KEY = 'pixel-editor:workspace-background';
export const THEME_KEY = 'pixel-editor:theme';
export const DEFAULT_CANVAS_BACKGROUND = '#ffffff';
export const DEFAULT_WORKSPACE_BACKGROUND = '#34363f';
export const MAX_CUSTOM_SIZES = 16;

export type ThemePreference = 'system' | 'dark' | 'light';

export interface CanvasSize {
  width: number;
  height: number;
}

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface EditorPreferences {
  customSizes: CanvasSize[];
  canvasBackground: string;
  workspaceBackground: string;
  theme: ThemePreference;
  error: string | null;
}

function isBuiltInSize(size: CanvasSize): boolean {
  return size.width === size.height && GRID_PRESETS.includes(size.width);
}

function isHexColor(value: string): boolean {
  return /^#[\da-f]{6}$/i.test(value);
}

function parseSizes(value: string | null): CanvasSize[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) return [];

  const sizes: CanvasSize[] = [];
  for (const item of parsed) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('width' in item) ||
      !('height' in item) ||
      typeof item.width !== 'number' ||
      typeof item.height !== 'number' ||
      !isValidCanvasSize(item.width, item.height)
    ) {
      continue;
    }
    const size = { width: item.width, height: item.height };
    if (
      isBuiltInSize(size) ||
      sizes.some((saved) => saved.width === size.width && saved.height === size.height)
    ) {
      continue;
    }
    sizes.push(size);
    if (sizes.length === MAX_CUSTOM_SIZES) break;
  }
  return sizes;
}

export function loadEditorPreferences(storage: PreferenceStorage | null): EditorPreferences {
  const defaults = {
    customSizes: [] as CanvasSize[],
    canvasBackground: DEFAULT_CANVAS_BACKGROUND,
    workspaceBackground: DEFAULT_WORKSPACE_BACKGROUND,
    theme: 'dark' as ThemePreference,
    error: null as string | null,
  };
  if (!storage) return defaults;

  try {
    const customSizes = parseSizes(storage.getItem(CUSTOM_SIZES_KEY));
    const savedBackground = storage.getItem(CANVAS_BACKGROUND_KEY);
    const savedWorkspaceBackground = storage.getItem(WORKSPACE_BACKGROUND_KEY);
    const savedTheme = storage.getItem(THEME_KEY);
    const canvasBackground =
      savedBackground && isHexColor(savedBackground) ? savedBackground : DEFAULT_CANVAS_BACKGROUND;
    return {
      customSizes,
      canvasBackground,
      workspaceBackground:
        savedWorkspaceBackground && isHexColor(savedWorkspaceBackground)
          ? savedWorkspaceBackground
          : DEFAULT_WORKSPACE_BACKGROUND,
      theme: isThemePreference(savedTheme) ? savedTheme : defaults.theme,
      error: null,
    };
  } catch {
    return {
      ...defaults,
      error: 'Не удалось прочитать пользовательские настройки холста.',
    };
  }
}

export function saveCustomSizes(storage: PreferenceStorage | null, sizes: readonly CanvasSize[]): boolean {
  if (!storage) return false;
  const unique = parseSizes(JSON.stringify(sizes));
  try {
    storage.setItem(CUSTOM_SIZES_KEY, JSON.stringify(unique));
    return true;
  } catch {
    return false;
  }
}

export function saveCanvasBackground(storage: PreferenceStorage | null, color: string): boolean {
  if (!storage || !isHexColor(color)) return false;
  try {
    storage.setItem(CANVAS_BACKGROUND_KEY, color);
    return true;
  } catch {
    return false;
  }
}

export function saveWorkspaceBackground(storage: PreferenceStorage | null, color: string): boolean {
  if (!storage || !isHexColor(color)) return false;
  try {
    storage.setItem(WORKSPACE_BACKGROUND_KEY, color);
    return true;
  } catch {
    return false;
  }
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'dark' || value === 'light';
}

export function saveThemePreference(storage: PreferenceStorage | null, theme: ThemePreference): boolean {
  if (!storage || !isThemePreference(theme)) return false;
  try {
    storage.setItem(THEME_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

export function currentSizeIsBuiltIn(width: number, height: number): boolean {
  return isBuiltInSize({ width, height });
}
