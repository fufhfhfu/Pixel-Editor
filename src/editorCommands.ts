export type SelectionAction =
  | 'select-all' | 'select-opaque' | 'invert' | 'deselect' | 'copy' | 'cut' | 'paste' | 'clear' | 'crop'
  | 'move-left' | 'move-right' | 'move-up' | 'move-down'
  | 'flip-horizontal' | 'flip-vertical' | 'rotate-left' | 'rotate-right' | 'scale-up' | 'scale-down';

const selectionActions: ReadonlySet<string> = new Set<SelectionAction>([
  'select-all', 'select-opaque', 'invert', 'deselect', 'copy', 'cut', 'paste', 'clear', 'crop',
  'move-left', 'move-right', 'move-up', 'move-down',
  'flip-horizontal', 'flip-vertical', 'rotate-left', 'rotate-right', 'scale-up', 'scale-down',
]);

function isSelectionAction(value: string): value is SelectionAction {
  return selectionActions.has(value);
}

export interface EditorCommandContext {
  actions: ReadonlyMap<string, () => void>;
  toolIds: readonly string[];
  panelIds: readonly string[];
  selectTool: (toolId: string) => void;
  selectPanel: (panelId: string) => void;
  runSelectionAction: (action: SelectionAction) => void;
}

export function dispatchEditorCommand(command: string, context: EditorCommandContext): void {
  if (command.startsWith('tool:')) {
    const toolId = command.slice(5);
    if (context.toolIds.includes(toolId)) context.selectTool(toolId);
    return;
  }
  if (command.startsWith('panel:')) {
    const panelId = command.slice(6);
    if (context.panelIds.includes(panelId)) context.selectPanel(panelId);
    return;
  }
  if (command.startsWith('selection-action:')) {
    const action = command.slice('selection-action:'.length);
    if (isSelectionAction(action)) context.runSelectionAction(action);
    return;
  }
  context.actions.get(command)?.();
}
