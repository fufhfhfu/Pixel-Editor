import type { PixelBuffer, RGBA } from '../state';

export type ToolId = 'pencil' | 'eraser' | 'fill' | 'picker' | 'line' | 'rect';

export interface ToolContext {
  readonly buffer: PixelBuffer;
  readonly color: RGBA;
  readonly brushSize: number;
  invalidate(): void;
  setColor(color: RGBA): void;
}

export interface ToolMeta {
  readonly id: ToolId;
  readonly label: string;
  readonly hotkeyCode: string;
  readonly hotkeyLabel: string;
  readonly hint?: string;
  readonly usesBrush: boolean;
  readonly usesColor: boolean;
}

export interface Tool extends ToolMeta {
  begin(ctx: ToolContext, x: number, y: number): void;
  move?(ctx: ToolContext, x: number, y: number): void;
  end?(ctx: ToolContext, x: number, y: number): void;
  cancel?(ctx: ToolContext): void;
}
