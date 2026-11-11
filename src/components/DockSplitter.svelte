<script lang="ts">
  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    valueDirection: 1 | -1;
    orientation?: 'horizontal' | 'vertical';
    onresize: (delta: number) => void;
  }

  let { label, value, min, max, valueDirection, orientation = 'horizontal', onresize }: Props = $props();
  let lastPosition = 0;
  let dragging = $state(false);

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    lastPosition = orientation === 'horizontal' ? event.clientX : event.clientY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging) return;
    const position = orientation === 'horizontal' ? event.clientX : event.clientY;
    const delta = position - lastPosition;
    lastPosition = position;
    if (delta !== 0) onresize(delta);
  }

  function onPointerEnd(): void {
    dragging = false;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (
      (orientation === 'horizontal' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) ||
      (orientation === 'vertical' && (event.key === 'ArrowUp' || event.key === 'ArrowDown'))
    ) {
      event.preventDefault();
      const increase = orientation === 'horizontal'
        ? event.key === 'ArrowRight'
        : event.key === 'ArrowUp';
      onresize((increase ? 8 : -8) * valueDirection);
    } else if (event.key === 'Home') {
      event.preventDefault();
      onresize((min - value) * valueDirection);
    } else if (event.key === 'End') {
      event.preventDefault();
      onresize((max - value) * valueDirection);
    }
  }
</script>

<div
  class="dock-splitter"
  class:vertical={orientation === 'vertical'}
  class:dragging
  role="slider"
  aria-orientation={orientation}
  aria-label={label}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuenow={value}
  tabindex="0"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerEnd}
  onpointercancel={onPointerEnd}
  onkeydown={onKeydown}
></div>

<style>
  .dock-splitter {
    position: relative;
    z-index: 3;
    flex: 0 0 5px;
    width: 5px;
    margin-inline: -2px;
    border-radius: 3px;
    cursor: col-resize;
    touch-action: none;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .dock-splitter::after {
    position: absolute;
    inset: 0 2px;
    background: transparent;
    content: '';
    transition: background 0.12s;
  }

  .dock-splitter:hover::after,
  .dock-splitter:focus-visible::after,
  .dock-splitter.dragging::after {
    background: var(--accent);
  }

  .dock-splitter:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .dock-splitter.vertical {
    flex: 0 0 5px;
    width: auto;
    height: 5px;
    margin: -2px 0;
    cursor: row-resize;
    touch-action: none;
  }

  .dock-splitter.vertical::after {
    inset: 2px 0;
  }

  @media (max-width: 859px) {
    .dock-splitter { display: none; }
  }
</style>
