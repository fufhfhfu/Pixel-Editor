import { describe, expect, it } from 'vitest';
import {
  getWorkspacePreset,
  isWorkspaceLayout,
  loadWorkspaceLayout,
  resizeWorkspaceDock,
  saveWorkspaceLayout,
  WORKSPACE_LAYOUT_KEY,
  type WorkspaceLayout,
} from './workspace';

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => { items.delete(key); },
    setItem: (key, value) => { items.set(key, value); },
  };
}

describe('workspace layouts', () => {
  it('loads, validates, and persists the current layout', () => {
    const storage = memoryStorage();
    const layout: WorkspaceLayout = {
      id: 'drawing',
      toolsVisible: true,
      paletteVisible: false,
      timelineVisible: true,
      rightPanel: 'layers',
      toolsWidth: 90,
      paletteWidth: 280,
      timelineHeight: 230,
    };

    expect(saveWorkspaceLayout(storage, layout)).toBe(true);
    expect(storage.getItem(WORKSPACE_LAYOUT_KEY)).toBe(JSON.stringify(layout));
    expect(loadWorkspaceLayout(storage)).toEqual({ layout, error: null });
    expect(isWorkspaceLayout({ ...layout, paletteWidth: 9999 })).toBe(false);
  });

  it('falls back with an explicit error for malformed saved layouts', () => {
    const storage = memoryStorage();
    storage.setItem(WORKSPACE_LAYOUT_KEY, '{bad');
    const result = loadWorkspaceLayout(storage);
    expect(result.layout.id).toBe('drawing');
    expect(result.error).toMatch(/прочитать/);
  });

  it('provides independent presets and clamps dock resizing to safe ranges', () => {
    const preset = getWorkspacePreset('minimal');
    expect(preset.toolsVisible).toBe(false);
    expect(resizeWorkspaceDock(preset, 'tools', 1000).toolsWidth).toBe(180);
    expect(resizeWorkspaceDock(preset, 'palette', -1000).paletteWidth).toBe(400);
    expect(resizeWorkspaceDock(preset, 'timeline', 1000).timelineHeight).toBe(90);
    expect(resizeWorkspaceDock(preset, 'tools', Number.NaN)).toBe(preset);
  });

  it('migrates saved layouts created before the timeline dock was added', () => {
    const storage = memoryStorage();
    storage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify({
      id: 'drawing',
      toolsVisible: true,
      paletteVisible: false,
      toolsWidth: 90,
      paletteWidth: 280,
    }));

    expect(loadWorkspaceLayout(storage).layout).toMatchObject({
      id: 'drawing',
      paletteVisible: false,
      timelineVisible: false,
      rightPanel: 'palette',
      timelineHeight: 150,
    });
  });
});
