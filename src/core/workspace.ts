import type { PreferenceStorage } from './preferences';

export const WORKSPACE_LAYOUT_KEY = 'pixel-editor:workspace-layout';

export type WorkspaceId = 'drawing' | 'animation' | 'tileset' | 'minimal';
export type DockId = 'tools' | 'palette' | 'timeline';
export type WorkspacePanelId =
  | 'colors' | 'palette' | 'layers' | 'properties' | 'brush-settings' | 'reference'
  | 'history' | 'navigator' | 'preview' | 'brush-library' | 'grid-settings' | 'export';

export interface WorkspaceLayout {
  id: WorkspaceId;
  toolsVisible: boolean;
  paletteVisible: boolean;
  timelineVisible: boolean;
  rightPanel: WorkspacePanelId;
  toolsWidth: number;
  paletteWidth: number;
  timelineHeight: number;
}

export const WORKSPACE_PRESETS: Readonly<Record<WorkspaceId, WorkspaceLayout>> = {
  drawing: { id: 'drawing', toolsVisible: true, paletteVisible: true, timelineVisible: false, rightPanel: 'palette', toolsWidth: 72, paletteWidth: 236, timelineHeight: 150 },
  animation: { id: 'animation', toolsVisible: true, paletteVisible: true, timelineVisible: true, rightPanel: 'layers', toolsWidth: 72, paletteWidth: 236, timelineHeight: 180 },
  tileset: { id: 'tileset', toolsVisible: false, paletteVisible: false, timelineVisible: false, rightPanel: 'palette', toolsWidth: 72, paletteWidth: 236, timelineHeight: 150 },
  minimal: { id: 'minimal', toolsVisible: false, paletteVisible: false, timelineVisible: false, rightPanel: 'palette', toolsWidth: 72, paletteWidth: 236, timelineHeight: 150 },
};

const TOOL_WIDTH_RANGE = { min: 48, max: 180 };
const PALETTE_WIDTH_RANGE = { min: 180, max: 400 };
const TIMELINE_HEIGHT_RANGE = { min: 90, max: 360 };
const WORKSPACE_PANELS: readonly WorkspacePanelId[] = [
  'colors', 'palette', 'layers', 'properties', 'brush-settings', 'reference',
  'history', 'navigator', 'preview', 'brush-library', 'grid-settings', 'export',
];

function isWorkspaceId(value: unknown): value is WorkspaceId {
  return value === 'drawing' || value === 'animation' || value === 'tileset' || value === 'minimal';
}

function clampWidth(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value)))
    : fallback;
}

export function isWorkspaceLayout(value: unknown): value is WorkspaceLayout {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const layout = value as Partial<WorkspaceLayout>;
  return isWorkspaceId(layout.id) &&
    typeof layout.toolsVisible === 'boolean' &&
    typeof layout.paletteVisible === 'boolean' &&
    typeof layout.timelineVisible === 'boolean' &&
    WORKSPACE_PANELS.includes(layout.rightPanel as WorkspacePanelId) &&
    Number.isInteger(layout.toolsWidth) &&
    layout.toolsWidth! >= TOOL_WIDTH_RANGE.min &&
    layout.toolsWidth! <= TOOL_WIDTH_RANGE.max &&
    Number.isInteger(layout.paletteWidth) &&
    layout.paletteWidth! >= PALETTE_WIDTH_RANGE.min &&
    layout.paletteWidth! <= PALETTE_WIDTH_RANGE.max &&
    Number.isInteger(layout.timelineHeight) &&
    layout.timelineHeight! >= TIMELINE_HEIGHT_RANGE.min &&
    layout.timelineHeight! <= TIMELINE_HEIGHT_RANGE.max;
}

export function loadWorkspaceLayout(storage: PreferenceStorage | null): {
  layout: WorkspaceLayout;
  error: string | null;
} {
  const fallback = WORKSPACE_PRESETS.drawing;
  if (!storage) return { layout: fallback, error: 'Рабочее пространство не сохранено: локальное хранилище недоступно.' };
  try {
    const raw = storage.getItem(WORKSPACE_LAYOUT_KEY);
    if (!raw) return { layout: fallback, error: null };
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
      return { layout: fallback, error: 'Сохранённая раскладка рабочего пространства повреждена; применена стандартная.' };
    }
    const value = stored as Partial<WorkspaceLayout>;
    const migrated = {
      ...getWorkspacePreset(isWorkspaceId(value.id) ? value.id : 'drawing'),
      ...value,
    };
    if (!isWorkspaceLayout(migrated)) {
      return { layout: fallback, error: 'Сохранённая раскладка рабочего пространства повреждена; применена стандартная.' };
    }
    return { layout: migrated, error: null };
  } catch {
    return { layout: fallback, error: 'Не удалось прочитать сохранённую раскладку рабочего пространства.' };
  }
}

export function saveWorkspaceLayout(storage: PreferenceStorage | null, layout: WorkspaceLayout): boolean {
  if (!storage || !isWorkspaceLayout(layout)) return false;
  try {
    storage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}

export function getWorkspacePreset(id: WorkspaceId): WorkspaceLayout {
  return { ...WORKSPACE_PRESETS[id] };
}

export function resizeWorkspaceDock(layout: WorkspaceLayout, dock: DockId, delta: number): WorkspaceLayout {
  if (!Number.isFinite(delta)) return layout;
  if (dock === 'tools') {
    return {
      ...layout,
      toolsWidth: clampWidth(layout.toolsWidth + delta, TOOL_WIDTH_RANGE.min, TOOL_WIDTH_RANGE.max, 72),
    };
  }
  if (dock === 'timeline') {
    return {
      ...layout,
      timelineHeight: clampWidth(
        layout.timelineHeight - delta,
        TIMELINE_HEIGHT_RANGE.min,
        TIMELINE_HEIGHT_RANGE.max,
        150,
      ),
    };
  }
  return {
    ...layout,
    paletteWidth: clampWidth(layout.paletteWidth - delta, PALETTE_WIDTH_RANGE.min, PALETTE_WIDTH_RANGE.max, 236),
  };
}
