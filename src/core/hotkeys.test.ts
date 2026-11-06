import { describe, expect, it } from 'vitest';
import {
  cloneShortcutMap,
  createDefaultShortcutMap,
  findShortcutConflicts,
  formatShortcut,
  formatShortcutSequence,
  getShortcutAction,
  HOTKEYS_STORAGE_KEY,
  loadShortcutMap,
  parseShortcutScheme,
  saveShortcutMap,
  serializeShortcutScheme,
  resolveShortcutEvent,
} from './hotkeys';

describe('горячие клавиши', () => {
  it('сохраняет стандартные сочетания и отображает их читаемо', () => {
    const shortcuts = createDefaultShortcutMap();
    expect(getShortcutAction(shortcuts, {
      code: 'KeyP', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    })).toBe('tool:pencil');
    expect(getShortcutAction(shortcuts, {
      code: 'KeyZ', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false,
    })).toBe('redo');
    expect(getShortcutAction(shortcuts, {
      code: 'KeyZ', ctrlKey: false, shiftKey: false, altKey: false, metaKey: true,
    })).toBe('undo');
    expect(getShortcutAction(shortcuts, {
      code: 'Digit7', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    })).toBe('brush-size:7');
    expect(getShortcutAction(shortcuts, {
      code: 'Numpad7', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    })).toBe('brush-size:7');
    expect(formatShortcut(shortcuts.undo![0]![0]!)).toBe('Ctrl+Z');
    expect(formatShortcutSequence(shortcuts.pan![0]!)).toBe('Пробел');
  });

  it('сопоставляет клавишу по физическому коду, а не символу раскладки', () => {
    const shortcuts = createDefaultShortcutMap();
    expect(getShortcutAction(shortcuts, {
      code: 'KeyP', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    })).toBe('tool:pencil');
    expect(getShortcutAction(shortcuts, {
      code: 'AltRight', ctrlKey: false, shiftKey: false, altKey: true, metaKey: false,
    })).toBe('temporary-picker');
  });

  it('обнаруживает конфликты между действиями', () => {
    const shortcuts = createDefaultShortcutMap();
    shortcuts['tool:eraser'] = cloneShortcutMap(shortcuts)['tool:pencil']!;
    expect(findShortcutConflicts(shortcuts)).toHaveLength(1);
    expect(findShortcutConflicts({
      'action:ctrl': [[{ code: 'KeyZ', ctrl: true, shift: false, alt: false, meta: false }]],
      'action:meta': [[{ code: 'KeyZ', ctrl: false, shift: false, alt: false, meta: true }]],
    })).toHaveLength(1);
  });

  it('экспортирует и импортирует схему с валидацией', () => {
    const shortcuts = createDefaultShortcutMap();
    shortcuts['tool:pencil'] = [[{ code: 'KeyQ', ctrl: false, shift: true, alt: false, meta: false }]];
    const encoded = serializeShortcutScheme(shortcuts);
    expect(parseShortcutScheme(encoded)).toEqual(shortcuts);
    expect(() => parseShortcutScheme('{"version":99,"shortcuts":{}}')).toThrow(/не поддерживается/i);
    const conflicting = createDefaultShortcutMap();
    conflicting['tool:eraser'] = conflicting['tool:pencil']!.map((sequence) => sequence.map((entry) => ({ ...entry })));
    expect(() => parseShortcutScheme(serializeShortcutScheme(conflicting))).toThrow(/конфликт/i);
  });

  it('загружает и сохраняет пользовательскую схему в хранилище', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    const shortcuts = createDefaultShortcutMap();
    shortcuts['tool:pencil'] = [[{ code: 'KeyQ', ctrl: false, shift: false, alt: false, meta: false }]];

    expect(saveShortcutMap(storage, shortcuts)).toBe(true);
    expect(values.has(HOTKEYS_STORAGE_KEY)).toBe(true);
    expect(loadShortcutMap(storage)).toEqual({ shortcuts, error: null });
  });

  it('распознаёт последовательности, префиксы и мигрирует схему v1', () => {
    const shortcuts = createDefaultShortcutMap();
    shortcuts.undo = [[
      { code: 'KeyQ', ctrl: false, shift: false, alt: false, meta: false },
      { code: 'KeyZ', ctrl: false, shift: false, alt: false, meta: false },
    ]];
    const first = resolveShortcutEvent(shortcuts, [], {
      code: 'KeyQ', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    });
    expect(first).toEqual({ action: null, pending: [shortcuts.undo![0]![0]] });
    const second = resolveShortcutEvent(shortcuts, first.pending, {
      code: 'KeyZ', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    });
    expect(second).toEqual({ action: 'undo', pending: [] });
    expect(formatShortcutSequence(shortcuts.undo![0]!)).toBe('Q → Z');
    expect(findShortcutConflicts({
      single: [[{ code: 'KeyQ', ctrl: false, shift: false, alt: false, meta: false }]],
      sequence: [[
        { code: 'KeyQ', ctrl: false, shift: false, alt: false, meta: false },
        { code: 'KeyZ', ctrl: false, shift: false, alt: false, meta: false },
      ]],
    })).toHaveLength(1);

    const legacy = JSON.stringify({
      version: 1,
      shortcuts: { 'tool:pencil': [{ code: 'KeyQ', ctrl: false, shift: false, alt: false, meta: false }] },
    });
    expect(parseShortcutScheme(legacy)['tool:pencil']).toEqual([[
      { code: 'KeyQ', ctrl: false, shift: false, alt: false, meta: false },
    ]]);
  });
});
