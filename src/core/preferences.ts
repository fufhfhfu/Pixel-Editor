import { GRID_PRESETS, isValidCanvasSize } from './state';

export const CUSTOM_SIZES_KEY = 'pixel-editor:custom-sizes';
export const CANVAS_BACKGROUND_KEY = 'pixel-editor:canvas-background';
export const WORKSPACE_BACKGROUND_KEY = 'pixel-editor:workspace-background';
export const THEME_KEY = 'pixel-editor:theme';
export const GRID_MODE_KEY = 'pixel-editor:grid-mode';
export const GRID_SPACING_KEY = 'pixel-editor:grid-spacing';
export const SNAP_TO_GRID_KEY = 'pixel-editor:snap-to-grid';
export const CHECKERBOARD_KEY = 'pixel-editor:checkerboard';
export const SECONDARY_COLOR_DRAWING_KEY = 'pixel-editor:secondary-color-drawing';
export const DEFAULT_CANVAS_BACKGROUND = '#ffffff';
export const DEFAULT_WORKSPACE_BACKGROUND = '#34363f';
export const MAX_CUSTOM_SIZES = 16;
export const GRID_SPACINGS = [1, 2, 4, 8, 16, 32] as const;

export type ThemePreference = 'system' | 'dark' | 'light';
export type GridMode = 'pixel' | 'square' | 'isometric';

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
  gridMode: GridMode;
  gridSpacing: number;
  snapToGrid: boolean;
  checkerboard: boolean;
  secondaryColorDrawing: boolean;
  error: string | null;
}

function isBuiltInSize(size: CanvasSize): boolean {
  return size.width === size.height && GRID_PRESETS.includes(size.width);
}

function isHexColor(value: string): boolean {
  return /^#[\da-f]{6}$/i.test(value);
}

function isGridMode(value: string | null): value is GridMode {
  return value === 'pixel' || value === 'square' || value === 'isometric';
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
    gridMode: 'pixel' as GridMode,
    gridSpacing: 1,
    snapToGrid: false,
    checkerboard: true,
    secondaryColorDrawing: true,
    error: null as string | null,
  };
  if (!storage) return defaults;

  try {
    const customSizes = parseSizes(storage.getItem(CUSTOM_SIZES_KEY));
    const savedBackground = storage.getItem(CANVAS_BACKGROUND_KEY);
    const savedWorkspaceBackground = storage.getItem(WORKSPACE_BACKGROUND_KEY);
    const savedTheme = storage.getItem(THEME_KEY);
    const savedGridMode = storage.getItem(GRID_MODE_KEY);
    const savedGridSpacing = Number(storage.getItem(GRID_SPACING_KEY));
    const savedSnapToGrid = storage.getItem(SNAP_TO_GRID_KEY);
    const savedCheckerboard = storage.getItem(CHECKERBOARD_KEY);
    const savedSecondaryColorDrawing = storage.getItem(SECONDARY_COLOR_DRAWING_KEY);
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
      gridMode: isGridMode(savedGridMode) ? savedGridMode : defaults.gridMode,
      gridSpacing: GRID_SPACINGS.includes(savedGridSpacing as (typeof GRID_SPACINGS)[number])
        ? savedGridSpacing
        : defaults.gridSpacing,
      snapToGrid: savedSnapToGrid === 'true',
      checkerboard: savedCheckerboard !== 'false',
      secondaryColorDrawing: savedSecondaryColorDrawing !== 'false',
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

export function saveGridMode(storage: PreferenceStorage | null, mode: GridMode): boolean {
  if (!storage || !isGridMode(mode)) return false;
  try {
    storage.setItem(GRID_MODE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

export function saveGridSpacing(storage: PreferenceStorage | null, spacing: number): boolean {
  if (!storage || !GRID_SPACINGS.includes(spacing as (typeof GRID_SPACINGS)[number])) return false;
  try {
    storage.setItem(GRID_SPACING_KEY, String(spacing));
    return true;
  } catch {
    return false;
  }
}

export function saveSnapToGrid(storage: PreferenceStorage | null, enabled: boolean): boolean {
  if (!storage || typeof enabled !== 'boolean') return false;
  try {
    storage.setItem(SNAP_TO_GRID_KEY, String(enabled));
    return true;
  } catch {
    return false;
  }
}

export function saveCheckerboard(storage: PreferenceStorage | null, enabled: boolean): boolean {
  if (!storage || typeof enabled !== 'boolean') return false;
  try {
    storage.setItem(CHECKERBOARD_KEY, String(enabled));
    return true;
  } catch {
    return false;
  }
}

export function saveSecondaryColorDrawing(storage: PreferenceStorage | null, enabled: boolean): boolean {
  if (!storage || typeof enabled !== 'boolean') return false;
  try {
    storage.setItem(SECONDARY_COLOR_DRAWING_KEY, String(enabled));
    return true;
  } catch {
    return false;
  }
}

export function currentSizeIsBuiltIn(width: number, height: number): boolean {
  return isBuiltInSize({ width, height });
}
