<script lang="ts">
  import type { AnimationFrame } from '../core/animation';

  interface Props {
    frames: readonly AnimationFrame[];
    activeIndex: number;
    playing: boolean;
    onselect: (index: number) => void;
    onadd: () => void;
    onduplicate: () => void;
    onremove: () => void;
    onduration: (index: number, durationMs: number) => void;
    ontoggleplay: () => void;
  }

  let {
    frames,
    activeIndex,
    playing,
    onselect,
    onadd,
    onduplicate,
    onremove,
    onduration,
    ontoggleplay,
  }: Props = $props();

  function thumbnail(node: HTMLCanvasElement, frame: AnimationFrame) {
    let current = frame;
    let scheduledFrame = 0;
    node.width = 48;
    node.height = 48;

    function render(): void {
      const context = node.getContext('2d');
      if (!context) throw new Error('Не удалось создать миниатюру кадра.');
      const scale = Math.min(48 / current.buffer.width, 48 / current.buffer.height);
      const width = Math.max(1, Math.round(current.buffer.width * scale));
      const height = Math.max(1, Math.round(current.buffer.height * scale));
      const image = context.createImageData(width, height);
      for (let y = 0; y < height; y++) {
        const sourceY = Math.min(current.buffer.height - 1, Math.floor(y * current.buffer.height / height));
        for (let x = 0; x < width; x++) {
          const sourceX = Math.min(current.buffer.width - 1, Math.floor(x * current.buffer.width / width));
          const source = current.buffer.index(sourceX, sourceY);
          image.data.set(current.buffer.data.subarray(source, source + 4), (y * width + x) * 4);
        }
      }
      context.clearRect(0, 0, 48, 48);
      context.putImageData(image, Math.floor((48 - width) / 2), Math.floor((48 - height) / 2));
    }

    function scheduleRender(): void {
      if (scheduledFrame) return;
      scheduledFrame = requestAnimationFrame(() => {
        scheduledFrame = 0;
        render();
      });
    }

    let stopObserving = current.buffer.captureChanges(scheduleRender);
    render();
    return {
      update(next: AnimationFrame) {
        if (next.buffer !== current.buffer) {
          stopObserving();
          stopObserving = next.buffer.captureChanges(scheduleRender);
        }
        current = next;
        render();
      },
      destroy() {
        stopObserving();
        if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
      },
    };
  }
</script>

<section class="timeline" aria-label="Timeline кадров">
  <div class="timeline-toolbar">
    <strong>Timeline</strong>
    <div class="actions" role="group" aria-label="Управление анимацией">
      <button type="button" aria-label={playing ? 'Остановить воспроизведение' : 'Воспроизвести'} aria-pressed={playing}
        onclick={ontoggleplay}>{playing ? 'Стоп' : '▶'}</button>
      <button type="button" aria-label="Добавить кадр" title="Добавить пустой кадр" onclick={onadd}>＋</button>
      <button type="button" aria-label="Дублировать кадр" title="Дублировать выбранный кадр" onclick={onduplicate}>▣</button>
      <button type="button" aria-label="Удалить кадр" title="Удалить выбранный кадр" disabled={frames.length <= 1}
        onclick={onremove}>−</button>
    </div>
    <label class="duration">
      Длительность
      <input type="number" min="10" max="60000" step="10" aria-label="Длительность кадра (мс)"
        value={frames[activeIndex]?.durationMs ?? 100}
        onchange={(event) => onduration(activeIndex, Number(event.currentTarget.value))} />
      мс
    </label>
    <span class="frame-count">{frames.length} кадров</span>
  </div>
  <div class="frames" role="group" aria-label="Кадры анимации">
    {#each frames as frame, index (frame.id)}
      <button type="button" class="frame" class:active={index === activeIndex}
        aria-label="Кадр {index + 1}, {frame.durationMs} мс" aria-pressed={index === activeIndex}
        onclick={() => onselect(index)}>
        <canvas use:thumbnail={frame} aria-hidden="true"></canvas>
        <span>{index + 1}</span>
      </button>
    {/each}
  </div>
</section>

<style>
  .timeline {
    display: grid;
    gap: 8px;
    min-width: 0;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    background: var(--panel);
  }

  .timeline-toolbar, .actions, .duration {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .timeline-toolbar { flex-wrap: wrap; }
  .actions { gap: 4px; }
  .duration { color: var(--text-dim); font-size: 12px; }
  .duration input {
    width: 76px;
    min-height: 28px;
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text);
    font: inherit;
  }

  .actions button, .frame {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--text);
  }

  .actions button { min-width: 30px; min-height: 28px; cursor: pointer; }
  .actions button:disabled { opacity: 0.5; cursor: default; }
  .frame-count { margin-left: auto; color: var(--text-dim); font-size: 12px; }
  .frames { display: flex; gap: 8px; overflow-x: auto; min-height: 72px; }
  .frame {
    display: grid;
    flex: 0 0 64px;
    justify-items: center;
    gap: 2px;
    padding: 4px;
    cursor: pointer;
  }
  .frame.active { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .frame canvas {
    width: 48px;
    height: 48px;
    background-color: var(--panel-2);
    background-image: linear-gradient(45deg, var(--border) 25%, transparent 25%),
      linear-gradient(-45deg, var(--border) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--border) 75%),
      linear-gradient(-45deg, transparent 75%, var(--border) 75%);
    background-size: 8px 8px;
    background-position: 0 0, 0 4px, 4px -4px, -4px 0;
    image-rendering: pixelated;
  }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  @media (max-width: 600px) {
    .timeline { max-height: 150px; }
  }
</style>
