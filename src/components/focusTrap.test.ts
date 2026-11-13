// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { trapFocus } from './focusTrap';

function createDialog() {
  const trigger = document.createElement('button');
  const dialog = document.createElement('div');
  dialog.innerHTML = `
    <input type="file" hidden>
    <button class="first">First</button>
    <div aria-hidden="true"><button>Hidden from accessibility tree</button></div>
    <button class="last">Last</button>
    <button style="display: none">Display none</button>
  `;
  document.body.append(trigger, dialog);
  for (const element of dialog.querySelectorAll<HTMLElement>('.first, .last')) {
    vi.spyOn(element, 'getClientRects').mockReturnValue([{} as DOMRect] as unknown as DOMRectList);
  }
  trigger.focus();
  return { trigger, dialog, first: dialog.querySelector<HTMLButtonElement>('.first')!, last: dialog.querySelector<HTMLButtonElement>('.last')! };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function pressTab(dialog: HTMLElement, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
  dialog.dispatchEvent(event);
  return event;
}

describe('dialog focus trap', () => {
  it('cycles between visible controls and skips hidden or aria-hidden inputs', () => {
    const { dialog, first, last } = createDialog();
    const action = trapFocus(dialog);

    first.focus();
    expect(pressTab(dialog, true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);

    last.focus();
    expect(pressTab(dialog).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    action.destroy();
  });

  it('moves focus into the visible tab order if it starts on a non-tabbable dialog element', () => {
    const { dialog, first } = createDialog();
    dialog.tabIndex = -1;
    const action = trapFocus(dialog);

    dialog.focus();
    expect(pressTab(dialog).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    action.destroy();
  });

  it('returns focus to the trigger when the dialog is destroyed', () => {
    const { trigger, dialog } = createDialog();
    const action = trapFocus(dialog, trigger);

    action.destroy();

    expect(document.activeElement).toBe(trigger);
    dialog.remove();
    trigger.remove();
  });
});
