import { TRANSPARENT } from '../color';
import type { PixelBuffer, RGBA } from '../state';
import { applyOpacity, bresenham, drawLine, drawRect, isPixelPerfectCorner, stampBrush } from './draw';
import { floodFill } from './floodFill';
import { applyDither, paintGradient, parseCustomDitherPattern } from './paintEffects';
import { forEachBrushPixel, stampBrushDefinition } from './brushLibrary';
import { createShapeTool } from './shape';
import { drawEllipse, drawPolygon, drawTriangle, polygonVertices } from './shapes';
import type { BrushShape, Tool, ToolContext, ToolId, ToolMeta } from './types';

export {
  applyOpacity,
  bresenham,
  drawLine,
  drawRect,
  isPixelPerfectCorner,
  stampBrush,
  stampCircle,
  stampSquare,
} from './draw';
export { floodFill } from './floodFill';
export type { FloodFillOptions } from './floodFill';
export { applyDither, ditherThreshold, paintGradient, parseCustomDitherPattern } from './paintEffects';
export type { DitherPattern, GradientKind, GradientStop } from './paintEffects';
export {
  createBrushDefinition,
  parseBrushDefinition,
  parseBrushLibrary,
  resizeBrushDefinition,
  serializeBrushLibrary,
  stampBrushDefinition,
} from './brushLibrary';
export type { BrushDefinition, BrushType } from './brushLibrary';
export { drawEllipse, drawPolygon, drawTriangle, polygonVertices } from './shapes';
export type { BrushShape, DrawingSettings, Tool, ToolContext, ToolId, ToolMeta } from './types';

export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 64;

function effectiveBrushSize(ctx: ToolContext): number {
  const pressure = Math.min(1, Math.max(0, ctx.pressure ?? 1));
  return Math.max(1, Math.round(ctx.brushSize * pressure));
}

function eraseBrush(ctx: ToolContext, x: number, y: number, shape: BrushShape): void {
  const size = effectiveBrushSize(ctx);
  const definition = ctx.brushDefinition;
  const startX = Math.trunc(x) - Math.floor((size - 1) / 2);
  const startY = Math.trunc(y) - Math.floor((size - 1) / 2);
  const opacity = Math.min(1, Math.max(0, ctx.opacity ?? 1)) * (definition?.opacity ?? 100) / 100;
  if (definition) {
    forEachBrushPixel(x, y, definition, ctx.pressure, (pixelX, pixelY) => {
      if (!ctx.buffer.inBounds(pixelX, pixelY)) return;
      const offset = ctx.buffer.index(pixelX, pixelY);
      const oldAlpha = ctx.buffer.data[offset + 3];
      if (oldAlpha === 0) return;
      const alpha = Math.round(oldAlpha * (1 - opacity));
      if (alpha === oldAlpha) return;
      ctx.buffer.setPixel(
        pixelX,
        pixelY,
        alpha === 0
          ? TRANSPARENT
          : { r: ctx.buffer.data[offset], g: ctx.buffer.data[offset + 1], b: ctx.buffer.data[offset + 2], a: alpha },
      );
    });
    return;
  }
  const center = (size - 1) / 2;
  const radiusSquared = (size / 2) ** 2;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      if (shape === 'circle' && (px - center) ** 2 + (py - center) ** 2 > radiusSquared) continue;
      const pixelX = startX + px;
      const pixelY = startY + py;
      if (!ctx.buffer.inBounds(pixelX, pixelY)) continue;
      const offset = ctx.buffer.index(pixelX, pixelY);
      const oldAlpha = ctx.buffer.data[offset + 3];
      if (oldAlpha === 0) continue;
      const alpha = Math.round(oldAlpha * (1 - opacity));
      if (alpha === oldAlpha) continue;
      ctx.buffer.setPixel(
        pixelX,
        pixelY,
        alpha === 0
          ? TRANSPARENT
          : { r: ctx.buffer.data[offset], g: ctx.buffer.data[offset + 1], b: ctx.buffer.data[offset + 2], a: alpha },
      );
    }
  }
}

const metadata: readonly ToolMeta[] = [
  { id: 'pencil', label: 'Карандаш', hotkeyCode: 'KeyP', hotkeyLabel: 'P', usesBrush: true, usesColor: true },
  { id: 'eraser', label: 'Ластик', hotkeyCode: 'KeyE', hotkeyLabel: 'E', usesBrush: true, usesColor: false },
  { id: 'fill', label: 'Заливка', hotkeyCode: 'KeyB', hotkeyLabel: 'B', usesBrush: false, usesColor: true },
  { id: 'picker', label: 'Пипетка', hotkeyCode: 'KeyI', hotkeyLabel: 'I', usesBrush: false, usesColor: false },
  { id: 'line', label: 'Линия', hotkeyCode: 'KeyL', hotkeyLabel: 'L', usesBrush: true, usesColor: true },
  { id: 'rect', label: 'Прямоугольник', hotkeyCode: 'KeyR', hotkeyLabel: 'R', usesBrush: true, usesColor: true },
  { id: 'filledRect', label: 'Залитый прямоугольник', hotkeyCode: 'KeyU', hotkeyLabel: 'U', usesBrush: true, usesColor: true },
  { id: 'circle', label: 'Окружность', hotkeyCode: 'KeyC', hotkeyLabel: 'C', usesBrush: true, usesColor: true },
  { id: 'filledCircle', label: 'Залитый круг', hotkeyCode: 'KeyJ', hotkeyLabel: 'J', usesBrush: true, usesColor: true },
  { id: 'ellipse', label: 'Эллипс', hotkeyCode: 'KeyO', hotkeyLabel: 'O', usesBrush: true, usesColor: true },
  { id: 'filledEllipse', label: 'Залитый эллипс', hotkeyCode: 'KeyK', hotkeyLabel: 'K', usesBrush: true, usesColor: true },
  { id: 'triangle', label: 'Треугольник', hotkeyCode: 'KeyT', hotkeyLabel: 'T', usesBrush: true, usesColor: true },
  { id: 'filledTriangle', label: 'Залитый треугольник', hotkeyCode: 'KeyY', hotkeyLabel: 'Y', usesBrush: true, usesColor: true },
  { id: 'polygon', label: 'Многоугольник', hotkeyCode: 'KeyN', hotkeyLabel: 'N', usesBrush: true, usesColor: true },
  { id: 'filledPolygon', label: 'Залитый многоугольник', hotkeyCode: 'KeyM', hotkeyLabel: 'M', usesBrush: true, usesColor: true },
  { id: 'gradient', label: 'Градиент', hotkeyCode: 'KeyV', hotkeyLabel: 'V', usesBrush: false, usesColor: true },
  { id: 'dither', label: 'Дизеринг', hotkeyCode: 'KeyD', hotkeyLabel: 'D', usesBrush: false, usesColor: true },
];

function createFreehandTool(meta: ToolMeta, colorFor: (ctx: ToolContext) => RGBA): Tool {
  let previous: { x: number; y: number } | null = null;
  let lastPressure = 1;
  let trail: Array<{ x: number; y: number }> = [];
  let wasPixelPerfect = false;
  let distanceSinceBrushStamp = 0;
  let lastBrushPosition: { x: number; y: number } | null = null;
  const paintAt = (ctx: ToolContext, x: number, y: number) => {
    if (meta.id === 'eraser') {
      eraseBrush(ctx, x, y, ctx.brushShape ?? 'square');
      return;
    }
    const color = colorFor(ctx);
    if ((ctx.opacity ?? 1) <= 0 || color.a === 0) return;
    if (ctx.brushDefinition) {
      let stepDistance = 0;
      if (lastBrushPosition) {
        stepDistance = Math.hypot(x - lastBrushPosition.x, y - lastBrushPosition.y);
        distanceSinceBrushStamp += stepDistance;
      }
      const currentPosition = { x, y };
      lastBrushPosition = currentPosition;
      if (distanceSinceBrushStamp < ctx.brushDefinition.spacing && stepDistance > 0) return;
      stampBrushDefinition(
        ctx.buffer,
        x,
        y,
        color,
        ctx.brushDefinition,
        ctx.opacity,
        ctx.pressure,
      );
      distanceSinceBrushStamp = 0;
      return;
    }
    stampBrush(
      ctx.buffer,
      x,
      y,
      effectiveBrushSize(ctx),
      applyOpacity(color, ctx.opacity),
      ctx.brushShape ?? 'square',
    );
  };
  const paint = (ctx: ToolContext, x: number, y: number, finish = false) => {
    const pixelPerfect = Boolean(ctx.settings?.pixelPerfect) && effectiveBrushSize(ctx) === 1;
    if (previous) {
      if (wasPixelPerfect && !pixelPerfect && trail.length > 1) {
        const held = trail.at(-1)!;
        paintAt(ctx, held.x, held.y);
        trail = [];
      }
      bresenham(previous.x, previous.y, x, y, (px, py) => {
        if (px === previous?.x && py === previous?.y) {
          const pressure = ctx.pressure ?? 1;
          if (pressure !== lastPressure) paintAt(ctx, px, py);
          lastPressure = pressure;
          return;
        }
        if (!pixelPerfect) {
          if (trail.length > 1) paintAt(ctx, trail.at(-1)!.x, trail.at(-1)!.y);
          trail = [];
          paintAt(ctx, px, py);
          return;
        }

        const point = { x: px, y: py };
        if (trail.length < 2) {
          trail.push(point);
          return;
        }
        const before = trail[trail.length - 2];
        const corner = trail[trail.length - 1];
        if (!isPixelPerfectCorner(before, corner, point)) paintAt(ctx, corner.x, corner.y);
        trail = [corner, point];
      });
    } else {
      paintAt(ctx, x, y);
      trail = [{ x, y }];
    }
    previous = { x, y };
    wasPixelPerfect = pixelPerfect;
    if (finish && trail.length > 1) paintAt(ctx, trail.at(-1)!.x, trail.at(-1)!.y);
    ctx.invalidate();
  };
  return {
    ...meta,
    begin(ctx, x, y) {
      previous = null;
      trail = [];
      lastPressure = ctx.pressure ?? 1;
      lastBrushPosition = null;
      distanceSinceBrushStamp = 0;
      paint(ctx, x, y);
    },
    move(ctx, x, y) {
      paint(ctx, x, y);
    },
    end(ctx, x, y) {
      paint(ctx, x, y, true);
      previous = null;
      trail = [];
      lastPressure = 1;
      lastBrushPosition = null;
      distanceSinceBrushStamp = 0;
    },
    cancel() {
      previous = null;
      trail = [];
      lastPressure = 1;
      lastBrushPosition = null;
      distanceSinceBrushStamp = 0;
    },
  };
}

function rectangularFill(
  buffer: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: RGBA,
  opacity = 1,
): void {
  const paint = applyOpacity(color, opacity);
  if (paint.a === 0) return;
  const left = Math.max(0, Math.min(x0, x1));
  const right = Math.min(buffer.width - 1, Math.max(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const bottom = Math.min(buffer.height - 1, Math.max(y0, y1));
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) buffer.setPixel(x, y, paint);
  }
}

function makeTool(id: ToolId): ToolMeta {
  return metadata.find((meta) => meta.id === id)!;
}

function createBoundedShapes(): Tool[] {
  const definitions: Array<[ToolId, (buffer: PixelBuffer, x0: number, y0: number, x1: number, y1: number, size: number, color: RGBA, shape?: BrushShape, opacity?: number, ctx?: ToolContext) => void]> = [
    ['line', drawLine],
    ['rect', (b, x0, y0, x1, y1, size, color, shape, opacity) => {
      drawRect(b, x0, y0, x1, y1, size, color, shape, opacity);
    }],
    ['filledRect', (b, x0, y0, x1, y1, size, color, shape, opacity, ctx) => {
      rectangularFill(b, x0, y0, x1, y1, ctx?.secondaryColor ?? color, opacity);
      drawRect(b, x0, y0, x1, y1, size, color, shape, opacity);
    }],
    ['circle', (b, x0, y0, x1, y1, size, color, _shape, opacity) => {
      const radius = Math.round(Math.hypot(x1 - x0, y1 - y0));
      drawEllipse(b, x0 - radius, y0 - radius, x0 + radius, y0 + radius, color, false, opacity, size);
    }],
    ['filledCircle', (b, x0, y0, x1, y1, size, color, _shape, opacity, ctx) => {
      const radius = Math.round(Math.hypot(x1 - x0, y1 - y0));
      drawEllipse(b, x0 - radius, y0 - radius, x0 + radius, y0 + radius, ctx?.secondaryColor ?? color, true, opacity);
      drawEllipse(b, x0 - radius, y0 - radius, x0 + radius, y0 + radius, color, false, opacity, size);
    }],
    ['ellipse', (b, x0, y0, x1, y1, size, color, _shape, opacity) => drawEllipse(b, x0, y0, x1, y1, color, false, opacity, size)],
    ['filledEllipse', (b, x0, y0, x1, y1, size, color, _shape, opacity, ctx) => {
      drawEllipse(b, x0, y0, x1, y1, ctx?.secondaryColor ?? color, true, opacity);
      drawEllipse(b, x0, y0, x1, y1, color, false, opacity, size);
    }],
    ['triangle', (b, x0, y0, x1, y1, size, color, _shape, opacity) => drawTriangle(b, x0, y0, x1, y1, color, false, opacity, size)],
    ['filledTriangle', (b, x0, y0, x1, y1, size, color, _shape, opacity, ctx) => {
      drawTriangle(b, x0, y0, x1, y1, ctx?.secondaryColor ?? color, true, opacity);
      drawTriangle(b, x0, y0, x1, y1, color, false, opacity, size);
    }],
    ['polygon', (b, x0, y0, x1, y1, size, color, _shape, opacity, ctx) =>
      drawPolygon(b, polygonVertices(x0, y0, x1, y1, ctx?.settings?.polygonSides ?? 6), color, false, opacity, size)],
    ['filledPolygon', (b, x0, y0, x1, y1, size, color, _shape, opacity, ctx) => {
      const vertices = polygonVertices(x0, y0, x1, y1, ctx?.settings?.polygonSides ?? 6);
      drawPolygon(b, vertices, ctx?.secondaryColor ?? color, true, opacity);
      drawPolygon(b, vertices, color, false, opacity, size);
    }],
    ['gradient', (b, x0, y0, x1, y1, _size, color, _shape, opacity, ctx) => {
      const settings = ctx?.settings;
      const endColor = settings?.gradientTransparency
        ? { ...color, a: 0 }
        : ctx?.secondaryColor ?? TRANSPARENT;
      const stops = settings?.gradientMidpointEnabled
        ? [
            { position: 0, color: applyOpacity(color, opacity) },
            { position: settings.gradientMidpointPosition / 100, color: applyOpacity(settings.gradientMidpoint, opacity) },
            { position: 1, color: applyOpacity(endColor, opacity) },
          ]
        : [{ position: 0, color: applyOpacity(color, opacity) }, { position: 1, color: applyOpacity(endColor, opacity) }];
      paintGradient(b, x0, y0, x1, y1, stops, {
        kind: settings?.gradientKind,
        dither: settings?.gradientDither,
      });
    }],
    ['dither', (b, x0, y0, x1, y1, _size, color, _shape, opacity, ctx) =>
      applyDither(
        b,
        x0,
        y0,
        x1,
        y1,
        applyOpacity(color, opacity),
        applyOpacity(ctx?.secondaryColor ?? TRANSPARENT, opacity),
        {
          pattern: ctx?.settings?.ditherPattern,
          density: ctx?.settings?.ditherDensity,
          scale: ctx?.settings?.ditherScale,
          angle: ctx?.settings?.ditherAngle,
          customPattern: ctx?.settings?.ditherPattern === 'custom'
            ? parseCustomDitherPattern(ctx.settings.ditherCustomPattern)
            : undefined,
        },
      )],
  ];
  return definitions.map(([id, draw]) => createShapeTool(makeTool(id), draw));
}

const tools: Tool[] = [
  createFreehandTool(metadata[0], (ctx) => ctx.color),
  createFreehandTool(metadata[1], () => TRANSPARENT),
  {
    ...metadata[2],
    begin(ctx, x, y) {
      floodFill(ctx.buffer, x, y, ctx.color, {
        contiguous: ctx.settings?.fillContiguous,
        tolerance: ctx.settings?.fillTolerance,
        connectivity: ctx.settings?.fillConnectivity,
        protectAlpha: ctx.settings?.fillProtectAlpha,
        opacity: ctx.opacity,
        sampleBuffer: ctx.sampleBuffer,
      });
      ctx.invalidate();
    },
  },
  {
    ...metadata[3],
    begin(ctx, x, y) {
      const radius = ctx.settings?.pickerRadius ?? 1;
      const sampleBuffer = ctx.sampleBuffer ?? ctx.buffer;
      const left = Math.max(0, x - Math.floor(radius / 2));
      const top = Math.max(0, y - Math.floor(radius / 2));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let py = top; py < top + radius && py < sampleBuffer.height; py++) {
        for (let px = left; px < left + radius && px < sampleBuffer.width; px++) {
          const sample = sampleBuffer.getPixel(px, py);
          if (!sample) continue;
          r += sample.r;
          g += sample.g;
          b += sample.b;
          a += sample.a;
          count++;
        }
      }
      if (count > 0 && a > 0) {
        ctx.setColor({ r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count), a: Math.round(a / count) });
      }
    },
  },
  ...createBoundedShapes(),
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
