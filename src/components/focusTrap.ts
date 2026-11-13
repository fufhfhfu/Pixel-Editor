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
  function isVisible(element: HTMLElement): boolean {
    if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.visibility !== 'collapse' &&
      element.getClientRects().length > 0;
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const activeIndex = items.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && activeIndex <= 0) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (activeIndex === -1 || activeIndex === items.length - 1)) {
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
