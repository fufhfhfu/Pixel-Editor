import type { PixelBuffer, RGBA } from '../state';
import type { BrushDefinition } from './brushLibrary';

export type ToolId =
  | 'pencil' | 'eraser' | 'fill' | 'picker' | 'line' | 'rect' | 'filledRect'
  | 'circle' | 'filledCircle' | 'ellipse' | 'filledEllipse' | 'triangle'
  | 'filledTriangle' | 'polygon' | 'filledPolygon' | 'gradient' | 'dither';
export type BrushShape = 'square' | 'circle';

export interface DrawingSettings {
  pixelPerfect: boolean;
  lineAngleSnap: 0 | 15 | 30 | 45 | 90;
  fillContiguous: boolean;
  fillTolerance: number;
  fillConnectivity: 4 | 8;
  fillProtectAlpha: boolean;
  sampleMerged: boolean;
  pickerRadius: 1 | 3 | 5 | 7;
  polygonSides: number;
  gradientKind: 'linear' | 'radial';
  gradientDither: boolean;
  gradientTransparency: boolean;
  gradientMidpointEnabled: boolean;
  gradientMidpoint: RGBA;
  gradientMidpointPosition: number;
  ditherPattern: 'checkerboard' | 'bayer2' | 'bayer4' | 'bayer8' | 'diagonal' | 'custom';
  ditherDensity: number;
  ditherScale: number;
  ditherAngle: 0 | 45 | 90 | 135;
  ditherCustomPattern: string;
}

export interface ToolContext {
  readonly buffer: PixelBuffer;
  readonly sampleBuffer?: PixelBuffer;
  readonly color: RGBA;
  readonly brushSize: number;
  readonly brushShape?: BrushShape;
  readonly brushDefinition?: BrushDefinition;
  readonly opacity?: number;
  readonly pressure?: number;
  readonly secondaryColor?: RGBA;
  readonly settings?: DrawingSettings;
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
