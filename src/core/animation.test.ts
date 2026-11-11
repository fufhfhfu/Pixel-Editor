import { describe, expect, it } from 'vitest';
import {
  advanceAnimation,
  createAnimationFrame,
  duplicateAnimationFrame,
  insertAnimationFrame,
  removeAnimationFrame,
  reorderAnimationFrame,
  updateFrameDuration,
  validateAnimationFrames,
} from './animation';

describe('animation timeline core', () => {
  it('creates independent frames and duplicates pixels without sharing storage', () => {
    const first = createAnimationFrame('first', 2, 1);
    first.buffer.setPixel(0, 0, { r: 255, g: 0, b: 0, a: 255 });
    const copy = duplicateAnimationFrame(first, 'copy');

    expect(copy.buffer.data).toEqual(first.buffer.data);
    expect(copy.buffer).not.toBe(first.buffer);
    copy.buffer.setPixel(0, 0, { r: 0, g: 0, b: 255, a: 255 });
    expect(first.buffer.getPixel(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it('inserts, reorders, removes frames, and prevents deleting the last frame', () => {
    const first = createAnimationFrame('first', 1, 1);
    const second = createAnimationFrame('second', 1, 1);
    const third = createAnimationFrame('third', 1, 1);
    const frames = insertAnimationFrame([first], second);
    const withThird = insertAnimationFrame(frames, third, 1);

    expect(withThird.map((frame) => frame.id)).toEqual(['first', 'third', 'second']);
    expect(reorderAnimationFrame(withThird, 0, 2).map((frame) => frame.id))
      .toEqual(['third', 'second', 'first']);
    expect(removeAnimationFrame(withThird, 1).map((frame) => frame.id)).toEqual(['first', 'second']);
    expect(() => removeAnimationFrame([first], 0)).toThrow(/at least one frame/);
  });

  it('advances across frame boundaries and wraps after multiple animation loops', () => {
    const frames = [
      updateFrameDuration(createAnimationFrame('a', 1, 1), 100),
      updateFrameDuration(createAnimationFrame('b', 1, 1), 250),
      updateFrameDuration(createAnimationFrame('c', 1, 1), 150),
    ];

    expect(advanceAnimation(frames, { frameIndex: 0, elapsedInFrameMs: 80 }, 50))
      .toEqual({ frameIndex: 1, elapsedInFrameMs: 30 });
    expect(advanceAnimation(frames, { frameIndex: 1, elapsedInFrameMs: 200 }, 550))
      .toEqual({ frameIndex: 2, elapsedInFrameMs: 0 });
    expect(advanceAnimation(frames, { frameIndex: 2, elapsedInFrameMs: 100 }, 550))
      .toEqual({ frameIndex: 0, elapsedInFrameMs: 0 });
  });

  it('rejects invalid duration, ids, dimensions, duplicate ids, and timeline positions', () => {
    const first = createAnimationFrame('first', 1, 1);
    const second = createAnimationFrame('second', 2, 1);

    expect(() => createAnimationFrame('', 1, 1)).toThrow(/id/);
    expect(() => updateFrameDuration(first, 9)).toThrow(/duration/);
    expect(() => validateAnimationFrames([first, second])).toThrow(/matching dimensions/);
    expect(() => validateAnimationFrames([first, first])).toThrow(/unique/);
    expect(() => advanceAnimation([first], { frameIndex: 1, elapsedInFrameMs: 0 }, 1)).toThrow(/position/);
    expect(() => advanceAnimation([first], { frameIndex: 0, elapsedInFrameMs: 0 }, Number.NaN))
      .toThrow(/Elapsed/);
  });
});
