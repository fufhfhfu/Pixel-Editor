import { TRANSPARENT } from '../color';
import type { RGBA } from '../state';
import { floodFill } from './floodFill';
import { createShapeTool } from './shape';
import { drawLine, drawRect, stampSquare, bresenham } from './draw';
import type { Tool, ToolContext, ToolId, ToolMeta } from './types';

export { bresenham, drawLine, drawRect, stampSquare } from './draw';
export type { Tool, ToolContext, ToolId, ToolMeta } from './types';

export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 4;

const metadata: readonly ToolMeta[] = [
  { id: 'pencil', label: 'Карандаш', hotkeyCode: 'KeyP', hotkeyLabel: 'P', usesBrush: true, usesColor: true },
  { id: 'eraser', label: 'Ластик', hotkeyCode: 'KeyE', hotkeyLabel: 'E', usesBrush: true, usesColor: false },
  { id: 'fill', label: 'Заливка', hotkeyCode: 'KeyB', hotkeyLabel: 'B', usesBrush: false, usesColor: true },
  { id: 'picker', label: 'Пипетка', hotkeyCode: 'KeyI', hotkeyLabel: 'I', usesBrush: false, usesColor: false },
  { id: 'line', label: 'Линия', hotkeyCode: 'KeyL', hotkeyLabel: 'L', usesBrush: true, usesColor: true },
  { id: 'rect', label: 'Прямоугольник', hotkeyCode: 'KeyR', hotkeyLabel: 'R', usesBrush: true, usesColor: true },
];

function createFreehandTool(meta: ToolMeta, colorFor: (ctx: ToolContext) => RGBA): Tool {
  let previous: { x: number; y: number } | null = null;
  const paint = (ctx: ToolContext, x: number, y: number) => {
    const color = colorFor(ctx);
    if (previous) {
      bresenham(previous.x, previous.y, x, y, (px, py) => stampSquare(ctx.buffer, px, py, ctx.brushSize, color));
    } else {
      stampSquare(ctx.buffer, x, y, ctx.brushSize, color);
    }
    previous = { x, y };
    ctx.invalidate();
  };
  return {
    ...meta,
    begin(ctx, x, y) {
      previous = null;
      paint(ctx, x, y);
    },
    move(ctx, x, y) {
      paint(ctx, x, y);
    },
    end(ctx, x, y) {
      paint(ctx, x, y);
      previous = null;
    },
    cancel() {
      previous = null;
    },
  };
}

const tools: Tool[] = [
  createFreehandTool(metadata[0], (ctx) => ctx.color),
  createFreehandTool(metadata[1], () => TRANSPARENT),
  {
    ...metadata[2],
    begin(ctx, x, y) {
      floodFill(ctx.buffer, x, y, ctx.color);
      ctx.invalidate();
    },
  },
  {
    ...metadata[3],
    begin(ctx, x, y) {
      const color = ctx.buffer.getPixel(x, y);
      if (color && color.a !== 0) ctx.setColor(color);
    },
  },
  createShapeTool(metadata[4], drawLine),
  createShapeTool(metadata[5], drawRect),
];

export const TOOLS: readonly Tool[] = Object.freeze(tools);

export function getTool(id: ToolId): Tool {
  const found = TOOLS.find((tool) => tool.id === id);
  if (!found) throw new RangeError(`Неизвестный инструмент: ${id}`);
  return found;
}

export function clampBrushSize(size: number): number {
  if (!Number.isFinite(size)) return MIN_BRUSH_SIZE;
  return Math.min(MAX_BRUSH_SIZE, Math.max(MIN_BRUSH_SIZE, Math.round(size)));
}
