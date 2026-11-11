import { TOOLS } from './tools';

export const HOTKEYS_STORAGE_KEY = 'pixel-editor:hotkeys';
export const HOTKEY_SCHEME_VERSION = 2;
export const MAX_SHORTCUT_SEQUENCE_LENGTH = 3;

export interface ShortcutBinding {
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export type ShortcutSequence = ShortcutBinding[];
export type ShortcutMap = Record<string, ShortcutSequence[]>;

export interface ShortcutAction {
  id: string;
  label: string;
  temporary?: 'picker' | 'pan';
}

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  ...TOOLS.map((tool) => ({ id: `tool:${tool.id}`, label: `Инструмент: ${tool.label}` })),
  { id: 'undo', label: 'Отменить' },
  { id: 'redo', label: 'Повторить' },
  { id: 'save', label: 'Сохранить проект' },
  { id: 'copy', label: 'Копировать выделение' },
  { id: 'cut', label: 'Вырезать выделение' },
  { id: 'paste', label: 'Вставить выделение' },
  { id: 'swap-colors', label: 'Поменять цвета местами' },
  { id: 'toggle-grid', label: 'Показать или скрыть сетку' },
  { id: 'fit', label: 'Вписать холсты в окно' },
  { id: 'help', label: 'Открыть справку' },
  { id: 'zoom-in', label: 'Увеличить масштаб' },
  { id: 'zoom-out', label: 'Уменьшить масштаб' },
  { id: 'temporary-picker', label: 'Временная пипетка', temporary: 'picker' },
  { id: 'pan', label: 'Временная панорама', temporary: 'pan' },
  ...Array.from({ length: 9 }, (_, index) => ({
    id: `brush-size:${index + 1}`,
    label: `Размер кисти: ${index + 1} px`,
  })),
];

const actionIds = new Set(SHORTCUT_ACTIONS.map((action) => action.id));
const actionById = new Map(SHORTCUT_ACTIONS.map((action) => [action.id, action]));

function binding(
  code: string,
  modifiers: Partial<Omit<ShortcutBinding, 'code'>> = {},
): ShortcutBinding {
  return { code, ctrl: false, shift: false, alt: false, meta: false, ...modifiers };
}

export function createDefaultShortcutMap(): ShortcutMap {
  const shortcuts: ShortcutMap = Object.fromEntries(SHORTCUT_ACTIONS.map(({ id }) => [id, []]));
  for (const tool of TOOLS) shortcuts[`tool:${tool.id}`] = [[binding(tool.hotkeyCode)]];
  shortcuts.undo = [[binding('KeyZ', { ctrl: true })]];
  shortcuts.redo = [[binding('KeyZ', { ctrl: true, shift: true })], [binding('KeyY', { ctrl: true })]];
  shortcuts.save = [[binding('KeyS', { ctrl: true })]];
  shortcuts.copy = [[binding('KeyC', { ctrl: true })]];
  shortcuts.cut = [[binding('KeyX', { ctrl: true })]];
  shortcuts.paste = [[binding('KeyV', { ctrl: true })]];
  shortcuts['swap-colors'] = [[binding('KeyX')]];
  shortcuts['toggle-grid'] = [[binding('KeyG')]];
  shortcuts.fit = [[binding('KeyF')]];
  shortcuts.help = [[binding('KeyH')], [binding('F1')]];
  shortcuts['zoom-in'] = [[binding('Equal')], [binding('NumpadAdd')]];
  shortcuts['zoom-out'] = [[binding('Minus')], [binding('NumpadSubtract')]];
  shortcuts['temporary-picker'] = [[binding('AltLeft')]];
  shortcuts.pan = [[binding('Space')]];
  for (let size = 1; size <= 9; size++) {
    shortcuts[`brush-size:${size}`] = [[binding(`Digit${size}`)], [binding(`Numpad${size}`)]];
  }
  return shortcuts;
}

export const DEFAULT_SHORTCUT_MAP = createDefaultShortcutMap();

export function cloneShortcutMap(shortcuts: ShortcutMap): ShortcutMap {
  return Object.fromEntries(Object.entries(shortcuts).map(([id, bindings]) => [
    id,
    bindings.map((sequence) => sequence.map((entry) => ({ ...entry }))),
  ]));
}

function bindingKey(shortcut: ShortcutBinding): string {
  return `${shortcut.code}|${Number(shortcut.ctrl || shortcut.meta)}${Number(shortcut.shift)}${Number(shortcut.alt)}`;
}

function sequenceKey(sequence: ShortcutSequence): string {
  return sequence.map(bindingKey).join('>');
}

export interface ShortcutConflict {
  binding: ShortcutBinding;
  sequence: ShortcutSequence;
  actions: string[];
}

export function findShortcutConflicts(shortcuts: ShortcutMap): ShortcutConflict[] {
  const grouped = new Map<string, ShortcutConflict>();
  const sequences: Array<{ key: string; sequence: ShortcutSequence; actionId: string }> = [];
  for (const [actionId, bindings] of Object.entries(shortcuts)) {
    for (const sequence of bindings) {
      const key = sequenceKey(sequence);
      sequences.push({ key, sequence, actionId });
      const existing = grouped.get(key);
      if (existing) {
        if (!existing.actions.includes(actionId) || existing.actions.length === 1) existing.actions.push(actionId);
      } else {
        grouped.set(key, { binding: sequence[0]!, sequence, actions: [actionId] });
      }
    }
  }
  const conflicts = [...grouped.values()].filter((conflict) => conflict.actions.length > 1);
  for (let i = 0; i < sequences.length; i++) {
    const first = sequences[i]!;
    for (let j = i + 1; j < sequences.length; j++) {
      const second = sequences[j]!;
      if (
        first.key !== second.key &&
        (first.key.startsWith(`${second.key}>`) || second.key.startsWith(`${first.key}>`))
      ) {
        conflicts.push({ binding: first.sequence[0]!, sequence: first.sequence, actions: [first.actionId, second.actionId] });
      }
    }
  }
  return conflicts;
}

export function formatShortcut(shortcut: ShortcutBinding): string {
  const parts: string[] = [];
  if (shortcut.ctrl) parts.push('Ctrl');
  if (shortcut.meta) parts.push('Meta');
  if (shortcut.alt) parts.push('Alt');
  if (shortcut.shift) parts.push('Shift');

  const codeLabels: Record<string, string> = {
    Space: 'Пробел',
    Equal: '=',
    Minus: '-',
    NumpadAdd: 'Num +',
    NumpadSubtract: 'Num -',
    AltLeft: 'Alt',
    AltRight: 'Alt',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    ControlLeft: 'Ctrl',
    ControlRight: 'Ctrl',
    MetaLeft: 'Meta',
    MetaRight: 'Meta',
  };
  const keyLabel = codeLabels[shortcut.code]
    ?? (/^Key[A-Z]$/.test(shortcut.code) ? shortcut.code.slice(3) : null)
    ?? (/^Digit\d$/.test(shortcut.code) ? shortcut.code.slice(5) : null)
    ?? (/^Numpad\d$/.test(shortcut.code) ? `Num ${shortcut.code.slice(6)}` : shortcut.code);
  if (!parts.includes(keyLabel)) parts.push(keyLabel);
  return parts.join('+');
}

export function formatShortcutSequence(sequence: ShortcutSequence): string {
  return sequence.map(formatShortcut).join(' → ');
}

export function isTemporaryShortcut(shortcutId: string): boolean {
  return actionById.get(shortcutId)?.temporary !== undefined;
}

function isModifierCode(code: string): boolean {
  return /^(Alt|Shift|Control|Meta)(Left|Right)$/.test(code);
}

export function getShortcutAction(
  shortcuts: ShortcutMap,
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
): string | null {
  return resolveShortcutEvent(shortcuts, [], event).action;
}

function eventBinding(
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
): ShortcutBinding {
  return {
    code: event.code,
    ctrl: event.ctrlKey && !event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
  };
}

function bindingsMatch(expected: ShortcutBinding, actual: ShortcutBinding, temporary: boolean): boolean {
  if (temporary && isModifierCode(actual.code)) {
    return expected.code === actual.code ||
      (expected.code === 'AltLeft' && actual.code === 'AltRight') ||
      (expected.code === 'AltRight' && actual.code === 'AltLeft');
  }
  return bindingKey(expected) === bindingKey(actual);
}

export interface ShortcutResolution {
  action: string | null;
  pending: ShortcutSequence;
}

export function resolveShortcutEvent(
  shortcuts: ShortcutMap,
  pending: ShortcutSequence,
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
): ShortcutResolution {
  const actual = eventBinding(event);
  const candidate = [...pending, actual];
  const matched = Object.entries(shortcuts).flatMap(([actionId, sequences]) =>
    sequences
      .filter((sequence) => sequence.length >= candidate.length &&
        candidate.every((entry, index) => bindingsMatch(sequence[index]!, entry, isTemporaryShortcut(actionId))))
      .map((sequence) => ({ actionId, sequence })),
  );
  const complete = matched.find((entry) => entry.sequence.length === candidate.length);
  if (complete) return { action: complete.actionId, pending: [] };
  if (matched.length) return { action: null, pending: candidate };
  if (pending.length) return resolveShortcutEvent(shortcuts, [], event);
  return { action: null, pending: [] };
}

export function getTemporaryActionForCode(shortcuts: ShortcutMap, code: string): string | null {
  for (const [actionId, bindings] of Object.entries(shortcuts)) {
    if (isTemporaryShortcut(actionId) && bindings.some((sequence) => sequence.length === 1 && (
      sequence[0]!.code === code ||
      (sequence[0]!.code === 'AltLeft' && code === 'AltRight') ||
      (sequence[0]!.code === 'AltRight' && code === 'AltLeft')
    ),
    )) return actionId;
  }
  return null;
}

function isShortcutBinding(value: unknown): value is ShortcutBinding {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === 'string' &&
    /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(candidate.code) &&
    ['ctrl', 'shift', 'alt', 'meta'].every((key) => typeof candidate[key] === 'boolean');
}

export function serializeShortcutScheme(shortcuts: ShortcutMap): string {
  return JSON.stringify({ version: HOTKEY_SCHEME_VERSION, shortcuts }, null, 2);
}

function isShortcutSequence(value: unknown): value is ShortcutSequence {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_SHORTCUT_SEQUENCE_LENGTH &&
    value.every(isShortcutBinding);
}

export function parseShortcutScheme(json: string): ShortcutMap {
  if (json.length > 64_000) throw new Error('Файл схемы горячих клавиш слишком большой.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Файл схемы горячих клавиш содержит некорректный JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Некорректный формат схемы горячих клавиш.');
  }
  const scheme = parsed as Record<string, unknown>;
  if (
    (scheme.version !== 1 && scheme.version !== HOTKEY_SCHEME_VERSION) ||
    typeof scheme.shortcuts !== 'object' ||
    scheme.shortcuts === null ||
    Array.isArray(scheme.shortcuts)
  ) {
    throw new Error('Версия или формат схемы горячих клавиш не поддерживается.');
  }

  const incoming = scheme.shortcuts as Record<string, unknown>;
  const unknownActions = Object.keys(incoming).filter((id) => !actionIds.has(id));
  if (unknownActions.length) throw new Error(`В схеме есть неизвестное действие: ${unknownActions[0]}.`);
  const shortcuts = createDefaultShortcutMap();
  for (const [actionId, rawBindings] of Object.entries(incoming)) {
    if (!Array.isArray(rawBindings) || rawBindings.length > 8) {
      throw new Error(`Некорректные сочетания для действия «${actionById.get(actionId)!.label}».`);
    }
    if (scheme.version === 1) {
      if (!rawBindings.every(isShortcutBinding)) {
        throw new Error(`Некорректные сочетания для действия «${actionById.get(actionId)!.label}».`);
      }
      shortcuts[actionId] = rawBindings.map((entry) => [{ ...entry }]);
    } else {
      if (!rawBindings.every(isShortcutSequence)) {
        throw new Error(`Некорректные сочетания для действия «${actionById.get(actionId)!.label}».`);
      }
      shortcuts[actionId] = rawBindings.map((sequence) => sequence.map((entry) => ({ ...entry })));
    }
    if (isTemporaryShortcut(actionId) && shortcuts[actionId]!.some((sequence) => sequence.length !== 1)) {
      throw new Error(`Временное действие «${actionById.get(actionId)!.label}» должно назначаться одной клавишей.`);
    }
  }
  const conflicts = findShortcutConflicts(shortcuts);
  if (conflicts.length) {
    const labels = conflicts[0]!.actions.map((id) => actionById.get(id)?.label ?? id).join(' и ');
    throw new Error(`Конфликт сочетания ${formatShortcut(conflicts[0]!.binding)}: ${labels}.`);
  }
  return shortcuts;
}

export interface ShortcutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadShortcutMap(storage: ShortcutStorage | null): { shortcuts: ShortcutMap; error: string | null } {
  if (!storage) return { shortcuts: cloneShortcutMap(DEFAULT_SHORTCUT_MAP), error: null };
  try {
    const saved = storage.getItem(HOTKEYS_STORAGE_KEY);
    return {
      shortcuts: saved ? parseShortcutScheme(saved) : cloneShortcutMap(DEFAULT_SHORTCUT_MAP),
      error: null,
    };
  } catch (error) {
    return {
      shortcuts: cloneShortcutMap(DEFAULT_SHORTCUT_MAP),
      error: `Не удалось загрузить сочетания клавиш: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function saveShortcutMap(storage: ShortcutStorage | null, shortcuts: ShortcutMap): boolean {
  if (!storage || findShortcutConflicts(shortcuts).length) return false;
  try {
    storage.setItem(HOTKEYS_STORAGE_KEY, serializeShortcutScheme(shortcuts));
    return true;
  } catch {
    return false;
  }
}
