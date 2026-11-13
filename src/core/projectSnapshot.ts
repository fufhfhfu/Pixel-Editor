import type { AnimationFrame } from './animation';
import type { Palette } from './palette';
import type { ProjectData, ProjectMetadata, ProjectNotesMetadata } from './project';
import type { PixelBuffer, RGBA } from './state';
import type { LayerGroup, RasterLayer } from './layers';
import type { ReferenceImage } from './reference';
import type { TilemapData } from './tilemap';
import type { BrushDefinition } from './tools';

export interface ProjectSnapshotBoard {
  id: string;
  x: number;
  y: number;
  layers: RasterLayer[];
  groups: LayerGroup[];
  activeLayerId: string;
  buffer: PixelBuffer;
}

export interface ProjectSnapshotInput {
  buffer: PixelBuffer;
  paletteId: string;
  freeColor: boolean;
  primary: RGBA;
  secondary: RGBA;
  recent: RGBA[];
  notes: string;
  notesMetadata: ProjectNotesMetadata;
  references: ReferenceImage[];
  customPalettes: Palette[];
  tilemap: TilemapData | null;
  brushes: BrushDefinition[];
  metadata: ProjectMetadata;
  boards: readonly ProjectSnapshotBoard[];
  activeBoardId: string;
  getAnimationFrames: (boardId: string, layerId: string) => AnimationFrame[] | undefined;
}

export function buildProjectSnapshot(input: ProjectSnapshotInput): ProjectData {
  return {
    width: input.buffer.width,
    height: input.buffer.height,
    pixels: input.buffer.data,
    paletteId: input.paletteId,
    freeColor: input.freeColor,
    primary: input.primary,
    secondary: input.secondary,
    recent: input.recent,
    notes: input.notes,
    notesMetadata: input.notesMetadata,
    references: input.references,
    customPalettes: input.customPalettes.length ? input.customPalettes : undefined,
    tilemap: input.tilemap ?? undefined,
    brushes: input.brushes,
    metadata: input.metadata,
    canvases: input.boards.map((board) => ({
      id: board.id,
      x: board.x,
      y: board.y,
      width: board.buffer.width,
      height: board.buffer.height,
      pixels: board.buffer.data,
      activeLayerId: board.activeLayerId,
      layers: board.layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        pixels: layer.buffer.data,
        visible: layer.visible,
        locked: layer.locked,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        alphaLock: layer.alphaLock,
        clippingMask: layer.clippingMask,
        role: layer.role ?? 'paint',
        effects: layer.effects,
        filters: layer.filters,
        groupId: layer.groupId ?? null,
        animationFrames: input.getAnimationFrames(board.id, layer.id)?.map((frame) => ({
          id: frame.id,
          durationMs: frame.durationMs,
          pixels: frame.buffer.data,
        })),
      })),
      groups: board.groups,
    })),
    activeCanvasId: input.activeBoardId,
  };
}
