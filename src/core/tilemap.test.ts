import { describe, expect, it } from 'vitest';
import {
  addTilemapLayer,
  buildTileAtlas,
  createTilemap,
  exportTilemapMetadata,
  fillTilemapRect,
  isValidTilemap,
  paintTilePixel,
  placeTile,
  resolveAnimatedTile,
  replaceTilePixels,
  sliceTileAtlas,
  tilemapCellAt,
} from './tilemap';

function atlas(): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(4 * 2 * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = i / 4 + 1;
    pixels[i + 3] = 255;
  }
  return pixels;
}

describe('tilemap core', () => {
  it('slices a pixel atlas into independent row-major tiles and rebuilds it', () => {
    const tiles = sliceTileAtlas(atlas(), 4, 2, 2, 2);
    expect(tiles.map((tile) => tile.id)).toEqual(['tile-1', 'tile-2']);
    expect(tiles.map((tile) => [...tile.pixels.filter((_, index) => index % 4 === 0)])).toEqual([
      [1, 2, 5, 6],
      [3, 4, 7, 8],
    ]);

    const map = { ...createTilemap(2, 2, 2, 2), tiles };
    const rebuilt = buildTileAtlas(map);
    expect([rebuilt.width, rebuilt.height]).toEqual([4, 2]);
    expect(rebuilt.pixels).toEqual(atlas());
  });

  it('places tiles, creates independent layers, and clears cells outside map boundaries safely', () => {
    const tiles = sliceTileAtlas(atlas(), 4, 2, 2, 2);
    let map = { ...createTilemap(3, 2, 2, 2), tiles };
    map = placeTile(map, map.activeLayerId, 1, 0, tiles[0]!.id);
    expect(placeTile(map, map.activeLayerId, 1, 0, tiles[0]!.id)).toBe(map);
    map = addTilemapLayer(map, 'collision', 'Collision');
    expect(map.layers[0]!.cells[1]).toBe(tiles[0]!.id);
    expect(map.layers[1]!.cells[1]).toBeNull();
    expect(placeTile(map, map.activeLayerId, -1, 0, tiles[0]!.id)).toBe(map);
    expect(isValidTilemap(map)).toBe(true);
  });

  it('paints tile pixels immutably, preserves unrelated tiles, and ignores unchanged or out-of-range pixels', () => {
    const tiles = sliceTileAtlas(atlas(), 4, 2, 2, 2);
    const map = { ...createTilemap(2, 2, 2, 2), tiles };
    const painted = paintTilePixel(map, 'tile-1', 1, 0, { r: 12, g: 34, b: 56, a: 255 });

    expect(painted).not.toBe(map);
    expect([...painted.tiles[0]!.pixels.slice(4, 8)]).toEqual([12, 34, 56, 255]);
    expect(painted.tiles[1]!.pixels).toBe(tiles[1]!.pixels);
    expect(tiles[0]!.pixels[4]).not.toBe(12);
    const rebuiltAtlas = buildTileAtlas(painted);
    const atlasPixelOffset = 1 * 4;
    expect([...rebuiltAtlas.pixels.slice(atlasPixelOffset, atlasPixelOffset + 4)]).toEqual([12, 34, 56, 255]);
    expect(paintTilePixel(painted, 'tile-1', 1, 0, { r: 12, g: 34, b: 56, a: 255 })).toBe(painted);
    expect(paintTilePixel(painted, 'tile-1', 2, 0, { r: 0, g: 0, b: 0, a: 255 })).toBe(painted);
    expect(() => paintTilePixel(map, 'missing', 0, 0, { r: 0, g: 0, b: 0, a: 255 })).toThrow(/не найден/);
    expect(() => paintTilePixel(map, 'tile-1', 0, 0, { r: 256, g: 0, b: 0, a: 255 })).toThrow(/каналы RGBA/);
    expect(replaceTilePixels(map, 'tile-1', tiles[0]!.pixels)).toBe(map);
    expect(() => replaceTilePixels(map, 'tile-1', new Uint8ClampedArray(1))).toThrow(/Размер пиксельного буфера/);
    const replacementPixels = tiles[0]!.pixels.slice();
    replacementPixels[0] = 99;
    const replaced = replaceTilePixels(map, 'tile-1', replacementPixels);
    replacementPixels[0] = 100;
    expect(replaced.tiles[0]!.pixels[0]).toBe(99);
  });

  it('fills a rectangle with reproducible random variants and respects locked layers', () => {
    const tiles = sliceTileAtlas(atlas(), 4, 2, 2, 2);
    const map = { ...createTilemap(4, 3, 2, 2), tiles };
    const first = fillTilemapRect(map, map.activeLayerId, { column: 1, row: 0 }, { column: 3, row: 2 },
      ['tile-1', 'tile-2'], 42);
    const repeated = fillTilemapRect(map, map.activeLayerId, { column: 1, row: 0 }, { column: 3, row: 2 },
      ['tile-1', 'tile-2'], 42);
    expect(first.layers[0]!.cells).toEqual(repeated.layers[0]!.cells);
    expect(first.layers[0]!.cells.slice(0, 4)).toEqual([null, 'tile-2', 'tile-1', 'tile-2']);
    expect(() => fillTilemapRect({
      ...map,
      layers: map.layers.map((layer) => ({ ...layer, locked: true })),
    }, map.activeLayerId, { column: 0, row: 0 }, { column: 0, row: 0 }, ['tile-1'])).toThrow(/заблокирован/);
  });

  it('resolves animated tiles and cell coordinates for orthogonal, isometric, and hexagonal grids', () => {
    const tiles = sliceTileAtlas(atlas(), 4, 2, 2, 2);
    const map = {
      ...createTilemap(4, 4, 2, 2),
      tiles: [
        { ...tiles[0]!, animation: { frameTileIds: ['tile-1', 'tile-2'], frameDurationMs: 100 } },
        tiles[1]!,
      ],
    };
    expect(resolveAnimatedTile(map, 'tile-1', 100)?.id).toBe('tile-2');
    expect(resolveAnimatedTile(map, 'tile-1', 250)?.id).toBe('tile-1');
    expect(tilemapCellAt(map, 5, 3)).toEqual({ column: 2, row: 1 });
    expect(tilemapCellAt({ ...map, grid: 'isometric' }, 1, 1)).toEqual({ column: 1, row: 0 });
    expect(tilemapCellAt({ ...map, grid: 'hexagonal' }, 2, 1)).toEqual({ column: 1, row: 0 });
    expect(tilemapCellAt(map, -1, 0)).toBeNull();
  });

  it('exports engine-neutral map metadata with tile animation and atlas layout', () => {
    const tiles = sliceTileAtlas(atlas(), 4, 2, 2, 2);
    const map = {
      ...createTilemap(2, 2, 2, 2, 'isometric'),
      tiles: [
        { ...tiles[0]!, animation: { frameTileIds: ['tile-2'], frameDurationMs: 120 } },
        tiles[1]!,
      ],
    };
    const metadata = JSON.parse(exportTilemapMetadata(map)) as {
      format: string;
      grid: string;
      atlas: { width: number; height: number; layout: string };
      tiles: Array<{ animation: { frameDurationMs: number } | null }>;
    };
    expect(metadata.format).toBe('pixel-editor-tilemap');
    expect(metadata.grid).toBe('isometric');
    expect(metadata.atlas).toEqual({ width: 4, height: 2, layout: 'horizontal' });
    expect(metadata.tiles[0]!.animation?.frameDurationMs).toBe(120);
  });
});
