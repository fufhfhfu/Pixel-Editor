import { PixelBuffer } from './state';

export const MAX_ANIMATION_FRAMES = 256;
export const MIN_FRAME_DURATION_MS = 10;
export const MAX_FRAME_DURATION_MS = 60_000;
export const DEFAULT_FRAME_DURATION_MS = 100;

export interface AnimationFrame {
  readonly id: string;
  readonly durationMs: number;
  readonly buffer: PixelBuffer;
}

export interface AnimationPosition {
  readonly frameIndex: number;
  readonly elapsedInFrameMs: number;
}

export function createAnimationFrame(
  id: string,
  width: number,
  height: number,
  pixels?: Uint8ClampedArray,
  durationMs = DEFAULT_FRAME_DURATION_MS,
): AnimationFrame {
  validateFrameId(id);
  validateDuration(durationMs);
  return {
    id,
    durationMs,
    buffer: new PixelBuffer(width, height, pixels?.slice()),
  };
}

export function duplicateAnimationFrame(frame: AnimationFrame, id: string): AnimationFrame {
  return createAnimationFrame(id, frame.buffer.width, frame.buffer.height, frame.buffer.data, frame.durationMs);
}

export function updateFrameDuration(frame: AnimationFrame, durationMs: number): AnimationFrame {
  validateDuration(durationMs);
  return { ...frame, durationMs };
}

export function validateAnimationFrames(frames: readonly AnimationFrame[]): void {
  if (frames.length === 0 || frames.length > MAX_ANIMATION_FRAMES) {
    throw new RangeError(`An animation must contain 1 to ${MAX_ANIMATION_FRAMES} frames.`);
  }
  const ids = new Set<string>();
  const { width, height } = frames[0]!.buffer;
  for (const frame of frames) {
    validateFrameId(frame.id);
    validateDuration(frame.durationMs);
    if (ids.has(frame.id)) throw new RangeError('Animation frame ids must be unique.');
    ids.add(frame.id);
    if (frame.buffer.width !== width || frame.buffer.height !== height) {
      throw new RangeError('All animation frames must have matching dimensions.');
    }
  }
}

export function insertAnimationFrame(
  frames: readonly AnimationFrame[],
  frame: AnimationFrame,
  index = frames.length,
): AnimationFrame[] {
  validateAnimationFrames(frames);
  if (frames.length >= MAX_ANIMATION_FRAMES) {
    throw new RangeError(`An animation cannot contain more than ${MAX_ANIMATION_FRAMES} frames.`);
  }
  if (!Number.isInteger(index) || index < 0 || index > frames.length) {
    throw new RangeError('Animation frame index is out of range.');
  }
  const copy = [...frames];
  copy.splice(index, 0, frame);
  validateAnimationFrames(copy);
  return copy;
}

export function removeAnimationFrame(frames: readonly AnimationFrame[], index: number): AnimationFrame[] {
  validateAnimationFrames(frames);
  if (!Number.isInteger(index) || index < 0 || index >= frames.length) {
    throw new RangeError('Animation frame index is out of range.');
  }
  if (frames.length === 1) throw new RangeError('An animation must contain at least one frame.');
  return frames.filter((_, frameIndex) => frameIndex !== index);
}

export function reorderAnimationFrame(
  frames: readonly AnimationFrame[],
  fromIndex: number,
  toIndex: number,
): AnimationFrame[] {
  validateAnimationFrames(frames);
  if (
    !Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= frames.length ||
    !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= frames.length
  ) {
    throw new RangeError('Animation frame index is out of range.');
  }
  if (fromIndex === toIndex) return [...frames];
  const reordered = [...frames];
  const [frame] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, frame!);
  return reordered;
}

export function advanceAnimation(
  frames: readonly AnimationFrame[],
  position: AnimationPosition,
  elapsedMs: number,
): AnimationPosition {
  validateAnimationFrames(frames);
  if (
    !Number.isInteger(position.frameIndex) ||
    position.frameIndex < 0 ||
    position.frameIndex >= frames.length ||
    !Number.isFinite(position.elapsedInFrameMs) ||
    position.elapsedInFrameMs < 0 ||
    position.elapsedInFrameMs >= frames[position.frameIndex]!.durationMs
  ) {
    throw new RangeError('Animation position is invalid.');
  }
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new RangeError('Elapsed animation time must be finite and non-negative.');
  }

  const totalDuration = frames.reduce((total, frame) => total + frame.durationMs, 0);
  let time = (frames.slice(0, position.frameIndex).reduce((total, frame) => total + frame.durationMs, 0) +
    position.elapsedInFrameMs + elapsedMs) % totalDuration;
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    const durationMs = frames[frameIndex]!.durationMs;
    if (time < durationMs) return { frameIndex, elapsedInFrameMs: time };
    time -= durationMs;
  }
  return { frameIndex: 0, elapsedInFrameMs: 0 };
}

function validateFrameId(id: string): void {
  if (typeof id !== 'string' || id.length === 0 || id.length > 80) {
    throw new RangeError('Animation frame id must contain 1 to 80 characters.');
  }
}

function validateDuration(durationMs: number): void {
  if (
    !Number.isInteger(durationMs) ||
    durationMs < MIN_FRAME_DURATION_MS ||
    durationMs > MAX_FRAME_DURATION_MS
  ) {
    throw new RangeError(
      `Animation frame duration must be an integer from ${MIN_FRAME_DURATION_MS} to ${MAX_FRAME_DURATION_MS} ms.`,
    );
  }
}
