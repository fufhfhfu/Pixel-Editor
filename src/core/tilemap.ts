import { CHANNELS, isValidCanvasSize, type RGBA } from './state';

export const MAX_TILEMAP_TILES = 4096;
export const MAX_TILEMAP_CELLS = 1_000_000;
export const MAX_TILEMAP_LAYERS = 64;
export const MAX_TILEMAP_TOTAL_TILE_PIXELS = 4_194_304;
export const MAX_TILEMAP_RENDER_SIDE = 16_384;
export const MAX_TILEMAP_RENDER_PIXELS = 16_000_000;

export type TilemapGrid = 'orthogonal' | 'isometric' | 'hexagonal';

export interface TileDefinition {
  id: string;
  name: string;
  pixels: Uint8ClampedArray;
  variantGroup: string | null;
  animation: {
    frameTileIds: string[];
    frameDurationMs: number;
  } | null;
}

export interface TilemapLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  cells: Array<string | null>;
}

export interface TilemapData {
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  grid: TilemapGrid;
  tiles: TileDefinition[];
  layers: TilemapLayer[];
  activeLayerId: string;
}

export interface TilemapPoint {
  column: number;
  row: number;
}

export function isValidTilemap(value: unknown): value is TilemapData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const map = value as Partial<TilemapData>;
  if (
    !Number.isInteger(map.tileWidth) || !Number.isInteger(map.tileHeight) ||
    !isValidCanvasSize(map.tileWidth!, map.tileHeight!) ||
    !Number.isInteger(map.columns) || !Number.isInteger(map.rows) ||
    map.columns! < 1 || map.rows! < 1 ||
    map.columns! * map.rows! > MAX_TILEMAP_CELLS ||
    !(map.grid === 'orthogonal' || map.grid === 'isometric' || map.grid === 'hexagonal') ||
    !Array.isArray(map.tiles) || map.tiles.length > MAX_TILEMAP_TILES ||
    !Array.isArray(map.layers) || map.layers.length < 1 || map.layers.length > MAX_TILEMAP_LAYERS ||
    typeof map.activeLayerId !== 'string'
  ) return false;

  const tileIds = new Set<string>();
  let totalTilePixels = 0;
  for (const tile of map.tiles) {
    if (
      typeof tile.id !== 'string' || tile.id.length < 1 || tile.id.length > 80 || tileIds.has(tile.id) ||
      typeof tile.name !== 'string' || tile.name.trim().length < 1 || tile.name.length > 80 ||
      !(tile.variantGroup === null || (typeof tile.variantGroup === 'string' && tile.variantGroup.length <= 80)) ||
      !(tile.animation === null || (
        typeof tile.animation === 'object' &&
        Array.isArray(tile.animation.frameTileIds) &&
        tile.animation.frameTileIds.length > 0 &&
        tile.animation.frameTileIds.length <= MAX_TILEMAP_TILES &&
        Number.isInteger(tile.animation.frameDurationMs) &&
        tile.animation.frameDurationMs >= 16 &&
        tile.animation.frameDurationMs <= 60_000
      )) ||
      !(tile.pixels instanceof Uint8ClampedArray) ||
      tile.pixels.length !== map.tileWidth! * map.tileHeight! * CHANNELS
    ) return false;
    totalTilePixels += map.tileWidth! * map.tileHeight!;
    if (totalTilePixels > MAX_TILEMAP_TOTAL_TILE_PIXELS) return false;
    tileIds.add(tile.id);
  }
  for (const tile of map.tiles) {
    if (tile.animation?.frameTileIds.some((id) => !tileIds.has(id))) return false;
  }

  const layerIds = new Set<string>();
  for (const layer of map.layers) {
    if (
      typeof layer.id !== 'string' || layer.id.length < 1 || layer.id.length > 80 || layerIds.has(layer.id) ||
      typeof layer.name !== 'string' || layer.name.trim().length < 1 || layer.name.length > 80 ||
      typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean' ||
      !Array.isArray(layer.cells) || layer.cells.length !== map.columns! * map.rows! ||
      layer.cells.some((id) => id !== null && (typeof id !== 'string' || !tileIds.has(id)))
    ) return false;
    layerIds.add(layer.id);
  }
  const renderWidth = map.grid === 'orthogonal'
    ? map.columns! * map.tileWidth!
    : map.grid === 'isometric'
      ? Math.ceil((map.columns! + map.rows!) * map.tileWidth! / 2)
      : map.columns! * map.tileWidth!;
  const renderHeight = map.grid === 'orthogonal'
    ? map.rows! * map.tileHeight!
    : map.grid === 'isometric'
      ? Math.ceil((map.columns! + map.rows!) * map.tileHeight! / 2)
      : Math.ceil((map.rows! - 1) * map.tileHeight! * 0.75 + map.tileHeight! * 1.375);
  if (
    renderWidth > MAX_TILEMAP_RENDER_SIDE || renderHeight > MAX_TILEMAP_RENDER_SIDE ||
    renderWidth * renderHeight > MAX_TILEMAP_RENDER_PIXELS
  ) return false;
  return layerIds.has(map.activeLayerId);
}

export function createTilemap(
  columns: number,
  rows: number,
  tileWidth: number,
  tileHeight: number,
  grid: TilemapGrid = 'orthogonal',
): TilemapData {
  const map: TilemapData = {
    tileWidth,
    tileHeight,
    columns,
    rows,
    grid,
    tiles: [],
    layers: [{ id: 'tile-layer-1', name: 'Tile Layer 1', visible: true, locked: false, cells: Array(columns * rows).fill(null) }],
    activeLayerId: 'tile-layer-1',
  };
  if (!isValidTilemap(map)) throw new RangeError('Недопустимый размер или структура tilemap.');
  return map;
}

export function sliceTileAtlas(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  tileWidth: number,
  tileHeight: number,
): TileDefinition[] {
  if (
    !isValidCanvasSize(width, height) ||
    pixels.length !== width * height * CHANNELS ||
    !isValidCanvasSize(tileWidth, tileHeight)
  ) throw new RangeError('Недопустимые размеры изображения или тайла.');
  const columns = Math.floor(width / tileWidth);
  const rows = Math.floor(height / tileHeight);
  const count = columns * rows;
  if (count < 1 || count > MAX_TILEMAP_TILES) {
    throw new RangeError(`Количество тайлов должно быть от 1 до ${MAX_TILEMAP_TILES}.`);
  }
  const tiles: TileDefinition[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const data = new Uint8ClampedArray(tileWidth * tileHeight * CHANNELS);
      for (let y = 0; y < tileHeight; y++) {
        const source = ((row * tileHeight + y) * width + column * tileWidth) * CHANNELS;
        const target = y * tileWidth * CHANNELS;
        data.set(pixels.subarray(source, source + tileWidth * CHANNELS), target);
      }
      const index = tiles.length + 1;
      tiles.push({
        id: `tile-${index}`,
        name: `Tile ${index}`,
        pixels: data,
        variantGroup: null,
        animation: null,
      });
    }
  }
  return tiles;
}

export function addTilemapLayer(map: TilemapData, id: string, name: string): TilemapData {
  if (!isValidTilemap(map) || map.layers.length >= MAX_TILEMAP_LAYERS) {
    throw new RangeError('Нельзя добавить слой tilemap.');
  }
  if (!id || id.length > 80 || !name.trim() || name.length > 80 || map.layers.some((layer) => layer.id === id)) {
    throw new RangeError('Недопустимые имя или идентификатор слоя tilemap.');
  }
  const layer: TilemapLayer = {
    id,
    name: name.trim(),
    visible: true,
    locked: false,
    cells: Array(map.columns * map.rows).fill(null),
  };
  return { ...map, layers: [...map.layers, layer], activeLayerId: id };
}

export function placeTile(
  map: TilemapData,
  layerId: string,
  column: number,
  row: number,
  tileId: string | null,
): TilemapData {
  if (!isValidTilemap(map)) throw new RangeError('Некорректная карта тайлов.');
  const layer = map.layers.find((entry) => entry.id === layerId);
  if (!layer) throw new RangeError('Слой tilemap не найден.');
  if (layer.locked) throw new RangeError('Слой tilemap заблокирован.');
  if (!Number.isInteger(column) || !Number.isInteger(row) || column < 0 || row < 0 ||
      column >= map.columns || row >= map.rows) return map;
  if (tileId !== null && !map.tiles.some((tile) => tile.id === tileId)) {
    throw new RangeError('Тайл tilemap не найден.');
  }
  const index = row * map.columns + column;
  if (layer.cells[index] === tileId) return map;
  const cells = [...layer.cells];
  cells[index] = tileId;
  return {
    ...map,
    layers: map.layers.map((entry) => entry.id === layerId ? { ...entry, cells } : entry),
  };
}

export function paintTilePixel(
  map: TilemapData,
  tileId: string,
  x: number,
  y: number,
  color: RGBA,
): TilemapData {
  const tile = getEditableTile(map, tileId);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 ||
      x >= map.tileWidth || y >= map.tileHeight) return map;
  if (![color.r, color.g, color.b, color.a].every((channel) =>
    Number.isInteger(channel) && channel >= 0 && channel <= 255,
  )) throw new RangeError('Цвет пикселя должен содержать каналы RGBA от 0 до 255.');

  const offset = (y * map.tileWidth + x) * CHANNELS;
  if (
    tile.pixels[offset] === color.r &&
    tile.pixels[offset + 1] === color.g &&
    tile.pixels[offset + 2] === color.b &&
    tile.pixels[offset + 3] === color.a
  ) return map;

  const pixels = tile.pixels.slice();
  pixels[offset] = color.a === 0 ? 0 : color.r;
  pixels[offset + 1] = color.a === 0 ? 0 : color.g;
  pixels[offset + 2] = color.a === 0 ? 0 : color.b;
  pixels[offset + 3] = color.a;
  return {
    ...map,
    tiles: map.tiles.map((entry) => entry.id === tileId ? { ...entry, pixels } : entry),
  };
}

export function replaceTilePixels(map: TilemapData, tileId: string, pixels: Uint8ClampedArray): TilemapData {
  const tile = getEditableTile(map, tileId);
  if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== tile.pixels.length) {
    throw new RangeError('Размер пиксельного буфера не совпадает с размером тайла.');
  }
  if (pixels === tile.pixels) return map;
  let changed = false;
  for (let index = 0; index < pixels.length; index++) {
    if (pixels[index] !== tile.pixels[index]) {
      changed = true;
      break;
    }
  }
  if (!changed) return map;
  const ownedPixels = pixels.slice();
  return {
    ...map,
    tiles: map.tiles.map((entry) => entry.id === tileId ? { ...entry, pixels: ownedPixels } : entry),
  };
}

function getEditableTile(map: TilemapData, tileId: string): TileDefinition {
  if (!map || !isValidCanvasSize(map.tileWidth, map.tileHeight) || !Array.isArray(map.tiles)) {
    throw new RangeError('Некорректная карта тайлов.');
  }
  const tile = map.tiles.find((entry) => entry.id === tileId);
  if (!tile || !(tile.pixels instanceof Uint8ClampedArray) ||
      tile.pixels.length !== map.tileWidth * map.tileHeight * CHANNELS) {
    throw new RangeError('Тайл tilemap не найден или содержит некорректные пиксели.');
  }
  return tile;
}

export function fillTilemapRect(
  map: TilemapData,
  layerId: string,
  start: TilemapPoint,
  end: TilemapPoint,
  tileIds: readonly string[],
  seed = 1,
): TilemapData {
  if (!isValidTilemap(map)) throw new RangeError('Некорректная карта тайлов.');
  const layer = map.layers.find((entry) => entry.id === layerId);
  if (!layer) throw new RangeError('Слой tilemap не найден.');
  if (layer.locked) throw new RangeError('Слой tilemap заблокирован.');
  if (
    tileIds.length === 0 ||
    tileIds.some((id) => !map.tiles.some((tile) => tile.id === id)) ||
    !Number.isFinite(seed)
  ) throw new RangeError('Для заполнения указаны некорректные тайлы или seed.');
  const left = Math.max(0, Math.min(start.column, end.column));
  const right = Math.min(map.columns - 1, Math.max(start.column, end.column));
  const top = Math.max(0, Math.min(start.row, end.row));
  const bottom = Math.min(map.rows - 1, Math.max(start.row, end.row));
  if (left > right || top > bottom) return map;

  let state = (Math.trunc(seed) >>> 0) || 0x6d2b79f5;
  const cells = [...layer.cells];
  let changed = false;
  for (let row = top; row <= bottom; row++) {
    for (let column = left; column <= right; column++) {
      state = (Math.imul(state ^ (state >>> 15), state | 1) + 0x6d2b79f5) | 0;
      const random = ((state ^ (state + Math.imul(state ^ (state >>> 7), state | 61))) >>> 0) / 0x1_0000_0000;
      const index = row * map.columns + column;
      const tileId = tileIds[Math.floor(random * tileIds.length)]!;
      if (cells[index] !== tileId) changed = true;
      cells[index] = tileId;
    }
  }
  if (!changed) return map;
  return {
    ...map,
    layers: map.layers.map((entry) => entry.id === layerId ? { ...entry, cells } : entry),
  };
}

export function resolveAnimatedTile(map: TilemapData, tileId: string, elapsedMs: number): TileDefinition | null {
  const tile = map.tiles.find((entry) => entry.id === tileId);
  if (!tile) return null;
  const animation = tile.animation;
  if (!animation || !Number.isFinite(elapsedMs)) return tile;
  const frameIndex = Math.floor(Math.max(0, elapsedMs) / animation.frameDurationMs) % animation.frameTileIds.length;
  return map.tiles.find((entry) => entry.id === animation.frameTileIds[frameIndex]) ?? tile;
}

export function tilemapCellAt(
  map: Pick<TilemapData, 'columns' | 'rows' | 'tileWidth' | 'tileHeight' | 'grid'>,
  x: number,
  y: number,
): TilemapPoint | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let column: number;
  let row: number;
  if (map.grid === 'orthogonal') {
    column = Math.floor(x / map.tileWidth);
    row = Math.floor(y / map.tileHeight);
  } else if (map.grid === 'isometric') {
    const u = x / (map.tileWidth / 2);
    const v = y / (map.tileHeight / 2);
    column = Math.floor((u + v) / 2);
    row = Math.floor((v - u) / 2);
  } else {
    const rowHeight = map.tileHeight * 0.75;
    column = Math.round(x / map.tileWidth);
    row = Math.round((y - (column & 1) * rowHeight / 2) / rowHeight);
    const centerX = column * map.tileWidth;
    const centerY = row * rowHeight + (column & 1) * rowHeight / 2;
    const localX = (x - centerX) / (map.tileWidth / 2);
    const localY = (y - centerY) / (map.tileHeight / 2);
    if (Math.abs(localX) > 1 || Math.abs(localY) > 1 || Math.abs(localX) + Math.abs(localY) / 2 > 1) return null;
  }
  return column >= 0 && row >= 0 && column < map.columns && row < map.rows ? { column, row } : null;
}

export function buildTileAtlas(map: TilemapData): {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
} {
  if (!isValidTilemap(map)) throw new RangeError('Некорректная карта тайлов.');
  const width = map.tileWidth * map.tiles.length;
  const height = map.tileHeight;
  const pixels = new Uint8ClampedArray(width * height * CHANNELS);
  for (let tileIndex = 0; tileIndex < map.tiles.length; tileIndex++) {
    const tile = map.tiles[tileIndex]!;
    for (let row = 0; row < map.tileHeight; row++) {
      const source = row * map.tileWidth * CHANNELS;
      const target = (row * width + tileIndex * map.tileWidth) * CHANNELS;
      pixels.set(tile.pixels.subarray(source, source + map.tileWidth * CHANNELS), target);
    }
  }
  return { width, height, pixels };
}

export function exportTilemapMetadata(map: TilemapData): string {
  if (!isValidTilemap(map)) throw new RangeError('Некорректная карта тайлов.');
  return JSON.stringify({
    format: 'pixel-editor-tilemap',
    version: 1,
    tileSize: { width: map.tileWidth, height: map.tileHeight },
    size: { columns: map.columns, rows: map.rows },
    grid: map.grid,
    tiles: map.tiles.map(({ id, name, variantGroup, animation }) => ({ id, name, variantGroup, animation })),
    layers: map.layers.map(({ id, name, visible, locked, cells }) => ({ id, name, visible, locked, cells })),
    activeLayerId: map.activeLayerId,
    atlas: { width: map.tileWidth * map.tiles.length, height: map.tileHeight, layout: 'horizontal' },
  });
}
