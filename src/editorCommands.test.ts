import { describe, expect, it, vi } from 'vitest';
import { dispatchEditorCommand } from './editorCommands';

describe('маршрутизация команд редактора', () => {
  it('передаёт только известные инструменты, панели и команды', () => {
    const selectTool = vi.fn();
    const selectPanel = vi.fn();
    const actions = new Map([['save', vi.fn()]]);
    const runSelectionAction = vi.fn();
    const context = {
      actions,
      toolIds: ['pencil'],
      panelIds: ['layers'],
      selectTool,
      selectPanel,
      runSelectionAction,
    };

    dispatchEditorCommand('tool:pencil', context);
    dispatchEditorCommand('panel:layers', context);
    dispatchEditorCommand('selection-action:rotate-right', context);
    dispatchEditorCommand('save', context);
    dispatchEditorCommand('tool:unknown', context);
    dispatchEditorCommand('selection-action:unknown', context);
    dispatchEditorCommand('unknown', context);

    expect(selectTool).toHaveBeenCalledExactlyOnceWith('pencil');
    expect(selectPanel).toHaveBeenCalledExactlyOnceWith('layers');
    expect(runSelectionAction).toHaveBeenCalledExactlyOnceWith('rotate-right');
    expect(actions.get('save')).toHaveBeenCalledExactlyOnceWith();
  });
});
