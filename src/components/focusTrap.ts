/**
 * Svelte-действие для модальных окон: удерживает Tab внутри окна и возвращает фокус
 * на прежний элемент, когда окно закрывается.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapFocus(
  node: HTMLElement,
  returnFocusTo: HTMLElement | null = document.activeElement instanceof HTMLElement ? document.activeElement : null,
): { destroy(): void } {

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !node.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !node.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  node.addEventListener('keydown', onKeydown);
  return {
    destroy() {
      node.removeEventListener('keydown', onKeydown);
      returnFocusTo?.focus();
    },
  };
}
