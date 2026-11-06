<script lang="ts">
  import { onMount } from 'svelte';
  import {
    addTilemapLayer,
    buildTileAtlas,
    createTilemap,
    exportTilemapMetadata,
    fillTilemapRect,
    isValidTilemap,
    placeTile,
    replaceTilePixels,
    resolveAnimatedTile,
    sliceTileAtlas,
    tilemapCellAt,
    type TileDefinition,
    type TilemapData,
    type TilemapGrid,
    type TilemapPoint,
  } from '../core/tilemap';
  import { encodePng } from '../core/png';
  import { rgbaToCss } from '../core/color';
  import type { RGBA } from '../core/state';

  interface Props {
    sourceWidth: number;
    sourceHeight: number;
    sourcePixels: Uint8ClampedArray;
    primaryColor: RGBA;
    secondaryColor: RGBA;
    tilemap: TilemapData | null;
    ontilemapchange: (map: TilemapData, groupId?: string | null) => void;
    onclose: () => void;
  }

  let {
    sourceWidth,
    sourceHeight,
    sourcePixels,
    primaryColor,
    secondaryColor,
    tilemap,
    ontilemapchange,
    onclose,
  }: Props = $props();
  let tileWidth = $state(16);
  let tileHeight = $state(16);
  let mapColumns = $state(24);
  let mapRows = $state(16);
  let grid = $state<TilemapGrid>('orthogonal');
  let selectedTileId = $state('');
  let fillMode = $state(false);
  let seamlessPreview = $state(false);
  let variantGroup = $state('');
  let frameDuration = $state(120);
  let fillSeed = $state(1);
  let animationTime = $state(0);
  let error = $state('');
  let mapCanvas: HTMLCanvasElement | undefined = $state();
  let previewCanvas: HTMLCanvasElement | undefined = $state();
  let tileEditorCanvas: HTMLCanvasElement | undefined = $state();
  let dragStart: TilemapPoint | null = null;
  let mapPointerDown = false;
  let tileEditorPointerDown = false;
  let tileEditorPaintButton = 0;
  let tileEditorPixels: Uint8ClampedArray | null = null;
  let tileEditorTileId = '';
  let lastEditorPoint: { x: number; y: number } | null = null;
  let activeHistoryGroup: string | null = null;
  let historyGroupSequence = 0;
  const tileCanvasCache = new Map<string, {
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
    canvas: HTMLCanvasElement;
  }>();

  const activeLayer = $derived(tilemap?.layers.find((layer) => layer.id === tilemap.activeLayerId) ?? null);
  const selectedTile = $derived(tilemap?.tiles.find((tile) => tile.id === selectedTileId) ?? null);
  const mapSize = $derived(tilemap ? getMapSize(tilemap) : { width: 640, height: 480 });

  function getMapSize(map: TilemapData): { width: number; height: number } {
    if (map.grid === 'orthogonal') {
      return { width: map.columns * map.tileWidth, height: map.rows * map.tileHeight };
    }
    if (map.grid === 'isometric') {
      return {
        width: Math.ceil((map.columns + map.rows) * map.tileWidth / 2),
        height: Math.ceil((map.columns + map.rows) * map.tileHeight / 2),
      };
    }
    return {
      width: map.columns * map.tileWidth,
      height: Math.ceil((map.rows - 1) * map.tileHeight * 0.75 + map.tileHeight * 1.375),
    };
  }

  function tilePosition(map: TilemapData, column: number, row: number): { x: number; y: number } {
    if (map.grid === 'orthogonal') return { x: column * map.tileWidth, y: row * map.tileHeight };
    if (map.grid === 'isometric') {
      return {
        x: (column - row) * map.tileWidth / 2 + map.rows * map.tileWidth / 2 - map.tileWidth / 2,
        y: (column + row) * map.tileHeight / 2,
      };
    }
    return {
      x: column * map.tileWidth,
      y: row * map.tileHeight * 0.75 + (column & 1) * map.tileHeight * 0.375,
    };
  }

  function tileCanvas(tile: TileDefinition): HTMLCanvasElement {
    const cached = tileCanvasCache.get(tile.id);
    if (cached && cached.pixels === tile.pixels && cached.width === tileWidth && cached.height === tileHeight) {
      return cached.canvas;
    }
    const canvas = document.createElement('canvas');
    canvas.width = tileWidth;
    canvas.height = tileHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось создать предпросмотр тайла.');
    context.putImageData(new ImageData(tile.pixels, tileWidth, tileHeight), 0, 0);
    tileCanvasCache.set(tile.id, { pixels: tile.pixels, width: tileWidth, height: tileHeight, canvas });
    return canvas;
  }

  function drawTile(node: HTMLCanvasElement, pixels: Uint8ClampedArray): { update: (next: Uint8ClampedArray) => void } {
    const render = (data: Uint8ClampedArray) => {
      node.width = tileWidth;
      node.height = tileHeight;
      const context = node.getContext('2d');
      if (!context) throw new Error('Не удалось создать миниатюру тайла.');
      context.putImageData(new ImageData(data, tileWidth, tileHeight), 0, 0);
    };
    render(pixels);
    return { update: render };
  }

  function drawTileEditor(): void {
    if (!tileEditorCanvas || !selectedTile) return;
    tileEditorCanvas.width = tileWidth;
    tileEditorCanvas.height = tileHeight;
    const context = tileEditorCanvas.getContext('2d');
    if (!context) throw new Error('Не удалось создать редактор пикселей тайла.');
    context.putImageData(new ImageData(tileEditorPixels ?? selectedTile.pixels, tileWidth, tileHeight), 0, 0);
    if (tileWidth <= 128 && tileHeight <= 128) {
      context.strokeStyle = 'rgba(0,0,0,0.28)';
      context.lineWidth = 0.5;
      context.beginPath();
      for (let x = 1; x < tileWidth; x++) {
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, tileHeight);
      }
      for (let y = 1; y < tileHeight; y++) {
        context.moveTo(0, y + 0.5);
        context.lineTo(tileWidth, y + 0.5);
      }
      context.stroke();
    }
  }

  function drawMap(): void {
    if (!tilemap || !mapCanvas) return;
    const size = getMapSize(tilemap);
    mapCanvas.width = size.width;
    mapCanvas.height = size.height;
    const context = mapCanvas.getContext('2d');
    if (!context) throw new Error('Не удалось создать canvas карты тайлов.');
    context.clearRect(0, 0, size.width, size.height);
    const tileIds = new Set(tilemap.tiles.map((tile) => tile.id));
    for (const id of tileCanvasCache.keys()) {
      if (!tileIds.has(id)) tileCanvasCache.delete(id);
    }
    const tileCanvases = new Map(tilemap.tiles.map((tile) => [tile.id, tileCanvas(tile)]));
    for (const layer of tilemap.layers) {
      if (!layer.visible) continue;
      for (let row = 0; row < tilemap.rows; row++) {
        for (let column = 0; column < tilemap.columns; column++) {
          const tileId = layer.cells[row * tilemap.columns + column];
          const tile = tileId ? resolveAnimatedTile(tilemap, tileId, animationTime) ?? undefined : undefined;
          const image = tile && tileCanvases.get(tile.id);
          if (!image) continue;
          const position = tilePosition(tilemap, column, row);
          context.drawImage(image, position.x, position.y);
        }
      }
    }
    drawGrid(context, tilemap);
  }

  function drawGrid(context: CanvasRenderingContext2D, map: TilemapData): void {
    context.strokeStyle = 'rgba(255,255,255,0.28)';
    context.lineWidth = 1;
    context.beginPath();
    for (let row = 0; row < map.rows; row++) {
      for (let column = 0; column < map.columns; column++) {
        const { x, y } = tilePosition(map, column, row);
        if (map.grid === 'orthogonal') {
          context.rect(x + 0.5, y + 0.5, map.tileWidth, map.tileHeight);
        } else if (map.grid === 'isometric') {
          context.moveTo(x + map.tileWidth / 2, y);
          context.lineTo(x + map.tileWidth, y + map.tileHeight / 2);
          context.lineTo(x + map.tileWidth / 2, y + map.tileHeight);
          context.lineTo(x, y + map.tileHeight / 2);
          context.closePath();
        } else {
          const cx = x + map.tileWidth / 2;
          const cy = y + map.tileHeight / 2;
          for (let side = 0; side < 6; side++) {
            const angle = Math.PI / 3 * side - Math.PI / 6;
            const px = cx + map.tileWidth / 2 * Math.cos(angle);
            const py = cy + map.tileHeight / 2 * Math.sin(angle);
            if (side === 0) context.moveTo(px, py);
            else context.lineTo(px, py);
          }
          context.closePath();
        }
      }
    }
    context.stroke();
  }

  function drawSeamlessPreview(): void {
    if (!previewCanvas || !selectedTile || !tilemap || !seamlessPreview) return;
    const context = previewCanvas.getContext('2d');
    if (!context) throw new Error('Не удалось создать предпросмотр бесшовного тайла.');
    previewCanvas.width = tileWidth * 5;
    previewCanvas.height = tileHeight * 5;
    const image = tileCanvas(selectedTile);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) context.drawImage(image, x * tileWidth, y * tileHeight);
    }
  }

  $effect(() => {
    void tilemap;
    void selectedTileId;
    void selectedTile?.pixels;
    void seamlessPreview;
    void animationTime;
    drawMap();
    drawTileEditor();
    drawSeamlessPreview();
  });

  $effect(() => {
    if (!tilemap?.tiles.some((tile) => tile.animation !== null)) return;
    const animationTimer = setInterval(() => {
      animationTime = Date.now();
    }, 50);
    return () => clearInterval(animationTimer);
  });

  function reportFailure(reason: unknown): void {
    error = reason instanceof Error ? reason.message : 'Операцию с tilemap выполнить не удалось.';
  }

  function beginHistoryGroup(): string {
    historyGroupSequence++;
    activeHistoryGroup = `tilemap-edit-${historyGroupSequence}`;
    return activeHistoryGroup;
  }

  function tileEditorPoint(event: PointerEvent): { x: number; y: number } | null {
    if (!tileEditorCanvas) return null;
    const bounds = tileEditorCanvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const x = Math.floor((event.clientX - bounds.left) * tileWidth / bounds.width);
    const y = Math.floor((event.clientY - bounds.top) * tileHeight / bounds.height);
    if (x < 0 || y < 0 || x >= tileWidth || y >= tileHeight) return null;
    return { x, y };
  }

  function drawTileEditorPixel(x: number, y: number): void {
    if (!tileEditorCanvas || !tileEditorPixels) return;
    const context = tileEditorCanvas.getContext('2d');
    if (!context) throw new Error('Не удалось создать редактор пикселей тайла.');
    const offset = (y * tileWidth + x) * 4;
    context.putImageData(new ImageData(tileEditorPixels.slice(offset, offset + 4), 1, 1), x, y);
    if (tileWidth <= 128 && tileHeight <= 128) {
      context.strokeStyle = 'rgba(0,0,0,0.28)';
      context.lineWidth = 0.5;
      context.beginPath();
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, tileHeight);
      context.moveTo(0, y + 0.5);
      context.lineTo(tileWidth, y + 0.5);
      context.stroke();
    }
  }

  function paintEditorPixel(event: PointerEvent): void {
    if (!tileEditorPixels || !tilemap || !selectedTile) return;
    const point = tileEditorPoint(event);
    if (!point) return;
    const color = tileEditorPaintButton === 2 ? secondaryColor : primaryColor;
    const start = lastEditorPoint ?? point;
    const distance = Math.max(Math.abs(point.x - start.x), Math.abs(point.y - start.y));
    try {
      for (let step = 0; step <= distance; step++) {
        const ratio = distance === 0 ? 0 : step / distance;
        const x = Math.round(start.x + (point.x - start.x) * ratio);
        const y = Math.round(start.y + (point.y - start.y) * ratio);
        const offset = (y * tileWidth + x) * 4;
        if (
          tileEditorPixels[offset] === color.r &&
          tileEditorPixels[offset + 1] === color.g &&
          tileEditorPixels[offset + 2] === color.b &&
          tileEditorPixels[offset + 3] === color.a
        ) continue;
        tileEditorPixels[offset] = color.a === 0 ? 0 : color.r;
        tileEditorPixels[offset + 1] = color.a === 0 ? 0 : color.g;
        tileEditorPixels[offset + 2] = color.a === 0 ? 0 : color.b;
        tileEditorPixels[offset + 3] = color.a;
        drawTileEditorPixel(x, y);
      }
    } catch (reason) {
      reportFailure(reason);
    }
    lastEditorPoint = point;
  }

  function onTileEditorPointerDown(event: PointerEvent): void {
    if (event.button !== 0 && event.button !== 2) return;
    if (!tilemap || !selectedTile) return;
    event.preventDefault();
    tileEditorPointerDown = true;
    tileEditorPaintButton = event.button;
    tileEditorTileId = selectedTile.id;
    tileEditorPixels = selectedTile.pixels.slice();
    lastEditorPoint = null;
    beginHistoryGroup();
    tileEditorCanvas?.setPointerCapture(event.pointerId);
    paintEditorPixel(event);
  }

  function onTileEditorPointerMove(event: PointerEvent): void {
    if (!tileEditorPointerDown) return;
    paintEditorPixel(event);
  }

  function finishTileEditorStroke(): void {
    const map = tilemap;
    const pixels = tileEditorPixels;
    const tileId = tileEditorTileId;
    const groupId = activeHistoryGroup;
    tileEditorPointerDown = false;
    tileEditorPixels = null;
    tileEditorTileId = '';
    lastEditorPoint = null;
    activeHistoryGroup = null;
    if (!map || !pixels || !tileId) return;
    try {
      const next = replaceTilePixels(map, tileId, pixels);
      if (next !== map) ontilemapchange(next, groupId);
      else drawTileEditor();
    } catch (reason) {
      reportFailure(reason);
    }
  }

  function cancelTileEditorStroke(): void {
    tileEditorPointerDown = false;
    tileEditorPixels = null;
    tileEditorTileId = '';
    lastEditorPoint = null;
    activeHistoryGroup = null;
    drawTileEditor();
  }

  function createTileset(): void {
    try {
      if (!Number.isInteger(tileWidth) || !Number.isInteger(tileHeight) ||
          tileWidth < 1 || tileHeight < 1 || tileWidth > sourceWidth || tileHeight > sourceHeight) {
        throw new RangeError('Размер тайла должен помещаться в исходное изображение.');
      }
      const tiles = sliceTileAtlas(sourcePixels, sourceWidth, sourceHeight, tileWidth, tileHeight);
      if (!tilemap) {
        const next = { ...createTilemap(mapColumns, mapRows, tileWidth, tileHeight, grid), tiles };
        selectedTileId = tiles[0]?.id ?? '';
        mapColumns = next.columns;
        mapRows = next.rows;
        ontilemapchange(next);
      } else {
        const validIds = new Set(tiles.map((tile) => tile.id));
        const next: TilemapData = {
          ...tilemap,
          tileWidth,
          tileHeight,
          tiles,
          layers: tilemap.layers.map((layer) => ({
            ...layer,
            cells: layer.cells.map((id) => id !== null && validIds.has(id) ? id : null),
          })),
        };
          if (!isValidTilemap(next)) throw new RangeError('Размер tileset превышает допустимый лимит проекта.');
          selectedTileId = tiles[0]?.id ?? '';
        ontilemapchange(next);
      }
      error = '';
    } catch (reason) {
      reportFailure(reason);
    }
  }

  function setGrid(nextGrid: TilemapGrid): void {
    if (tilemap) {
      const next = { ...tilemap, grid: nextGrid };
      if (!isValidTilemap(next)) {
        error = 'Эта сетка создаёт слишком большую карту для предпросмотра.';
        return;
      }
      ontilemapchange(next);
    }
    grid = nextGrid;
    error = '';
  }

  function resizeMap(): void {
    if (!tilemap) return;
    if (!Number.isInteger(mapColumns) || !Number.isInteger(mapRows) ||
        mapColumns < 1 || mapRows < 1 || mapColumns * mapRows > 1_000_000) {
      error = 'Размер карты должен содержать не более 1 000 000 ячеек.';
      return;
    }
    const layers = tilemap.layers.map((layer) => {
      const cells = Array<string | null>(mapColumns * mapRows).fill(null);
      for (let row = 0; row < Math.min(mapRows, tilemap.rows); row++) {
        for (let column = 0; column < Math.min(mapColumns, tilemap.columns); column++) {
          cells[row * mapColumns + column] = layer.cells[row * tilemap.columns + column]!;
        }
      }
      return { ...layer, cells };
    });
    const next = { ...tilemap, columns: mapColumns, rows: mapRows, layers };
    if (!isValidTilemap(next)) {
      error = 'Карта превышает безопасный размер предпросмотра.';
      return;
    }
    ontilemapchange(next);
    error = '';
  }

  function pointFromEvent(event: PointerEvent): TilemapPoint | null {
    if (!mapCanvas || !tilemap) return null;
    const bounds = mapCanvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * mapCanvas.width / bounds.width;
    const y = (event.clientY - bounds.top) * mapCanvas.height / bounds.height;
    if (tilemap.grid === 'isometric') {
      return tilemapCellAt(tilemap, x - tilemap.rows * tilemap.tileWidth / 2 + tilemap.tileWidth / 2, y);
    }
    return tilemapCellAt(tilemap, x, y);
  }

  function onMapPointerDown(event: PointerEvent): void {
    if (!tilemap || !activeLayer || activeLayer.locked) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    mapPointerDown = true;
    dragStart = point;
    beginHistoryGroup();
    mapCanvas?.setPointerCapture(event.pointerId);
    if (!fillMode && selectedTileId) {
      try {
        ontilemapchange(
          placeTile(tilemap, activeLayer.id, point.column, point.row, selectedTileId),
          activeHistoryGroup,
        );
      } catch (reason) {
        reportFailure(reason);
      }
    }
  }

  function onMapPointerMove(event: PointerEvent): void {
    if (!mapPointerDown || !tilemap || fillMode || !selectedTileId || !activeLayer || activeLayer.locked) return;
    const point = pointFromEvent(event);
    if (!point) return;
    try {
      ontilemapchange(
        placeTile(tilemap, activeLayer.id, point.column, point.row, selectedTileId),
        activeHistoryGroup,
      );
    } catch (reason) {
      reportFailure(reason);
    }
  }

  function onMapPointerUp(event: PointerEvent): void {
    if (!mapPointerDown || !tilemap || !activeLayer || activeLayer.locked) return;
    mapPointerDown = false;
    const end = pointFromEvent(event);
    const start = dragStart;
    dragStart = null;
    if (fillMode && start && end) {
      const tile = tilemap.tiles.find((entry) => entry.id === selectedTileId);
      const variants = tile?.variantGroup
        ? tilemap.tiles.filter((entry) => entry.variantGroup === tile.variantGroup).map((entry) => entry.id)
        : [selectedTileId];
      try {
        ontilemapchange(
          fillTilemapRect(tilemap, activeLayer.id, start, end, variants, fillSeed++),
          activeHistoryGroup,
        );
      } catch (reason) {
        reportFailure(reason);
      }
    }
    activeHistoryGroup = null;
  }

  function cancelMapStroke(): void {
    mapPointerDown = false;
    dragStart = null;
    activeHistoryGroup = null;
  }

  function addLayer(): void {
    if (!tilemap) return;
    try {
      const id = `tile-layer-${Date.now().toString(36)}`;
      ontilemapchange(addTilemapLayer(tilemap, id, `Tile Layer ${tilemap.layers.length + 1}`));
    } catch (reason) {
      reportFailure(reason);
    }
  }

  function updateSelectedTile(update: Partial<Pick<TileDefinition, 'variantGroup' | 'animation'>>): void {
    if (!tilemap || !selectedTile) return;
    ontilemapchange({
      ...tilemap,
      tiles: tilemap.tiles.map((tile) => tile.id === selectedTile.id ? { ...tile, ...update } : tile),
    });
  }

  function assignAnimation(): void {
    if (!tilemap || !selectedTile || tilemap.tiles.length < 2) return;
    updateSelectedTile({
      animation: {
        frameTileIds: tilemap.tiles.map((tile) => tile.id),
        frameDurationMs: Math.max(16, Math.min(60_000, frameDuration)),
      },
    });
  }

  async function exportAtlas(): Promise<void> {
    if (!tilemap) return;
    const atlas = buildTileAtlas(tilemap);
    const png = await encodePng({ width: atlas.width, height: atlas.height, data: atlas.pixels });
    download(new Blob([png], { type: 'image/png' }), 'tileset.png');
  }

  function exportMetadata(): void {
    if (!tilemap) return;
    download(new Blob([exportTilemapMetadata(tilemap)], { type: 'application/json' }), 'tilemap.json');
  }

  function download(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  onMount(() => {
    if (tilemap) {
      tileWidth = tilemap.tileWidth;
      tileHeight = tilemap.tileHeight;
      mapColumns = tilemap.columns;
      mapRows = tilemap.rows;
      grid = tilemap.grid;
      selectedTileId = tilemap.tiles[0]?.id ?? '';
    }
  });
</script>

<section class="tilemap-editor" aria-label="Редактор Tilemap">
  <header>
    <h2>Редактор Tilemap</h2>
    <button type="button" aria-label="Закрыть редактор Tilemap" onclick={onclose}>Закрыть</button>
  </header>
  <div class="tilemap-toolbar">
    <label>Тайл W <input type="number" min="1" max={sourceWidth} bind:value={tileWidth} /></label>
    <label>H <input type="number" min="1" max={sourceHeight} bind:value={tileHeight} /></label>
    <button type="button" onclick={createTileset}>Создать tileset из активного холста</button>
    {#if tilemap}
      <label>Колонки <input type="number" min="1" max="4096" bind:value={mapColumns} /></label>
      <label>Строки <input type="number" min="1" max="4096" bind:value={mapRows} /></label>
      <button type="button" onclick={resizeMap}>Размер карты</button>
      <label>Сетка
        <select value={tilemap.grid} onchange={(event) => setGrid(event.currentTarget.value as TilemapGrid)}>
          <option value="orthogonal">Прямоугольная</option>
          <option value="isometric">Изометрическая</option>
          <option value="hexagonal">Гексагональная</option>
        </select>
      </label>
      <button type="button" aria-pressed={fillMode} class:active={fillMode} onclick={() => (fillMode = !fillMode)}>
        {fillMode ? 'Заливка: вкл.' : 'Заливка прямоугольника'}
      </button>
      <button type="button" aria-pressed={seamlessPreview} onclick={() => (seamlessPreview = !seamlessPreview)}>
        Бесшовное превью
      </button>
      <button type="button" onclick={() => void exportAtlas()}>Экспорт PNG tileset</button>
      <button type="button" onclick={exportMetadata}>Экспорт метаданных</button>
    {/if}
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if tilemap}
    <div class="tilemap-layout">
      <aside class="tiles">
        <h3>Tileset ({tilemap.tiles.length})</h3>
        <div class="tile-list">
          {#each tilemap.tiles as tile (tile.id)}
            <button type="button" class:selected={tile.id === selectedTileId}
              aria-label={`Выбрать ${tile.name}`} aria-pressed={tile.id === selectedTileId}
              onclick={() => (selectedTileId = tile.id)}>
                <canvas use:drawTile={tile.pixels}></canvas>
              <span>{tile.name}</span>
            </button>
          {/each}
        </div>
        {#if selectedTile}
          <h3>Редактор тайла</h3>
          <p>ЛКМ — основной цвет, ПКМ — дополнительный. Перетаскивайте указатель для штриха.</p>
          <div class="paint-colors" aria-label="Цвета рисования">
            <span><i style:background={rgbaToCss(primaryColor)}></i>Основной</span>
            <span><i style:background={rgbaToCss(secondaryColor)}></i>Дополнительный</span>
          </div>
          <canvas class="tile-pixel-editor" bind:this={tileEditorCanvas}
            aria-label="Редактор пикселей выбранного тайла"
            onpointerdown={onTileEditorPointerDown} onpointermove={onTileEditorPointerMove}
            onpointerup={finishTileEditorStroke} onpointercancel={cancelTileEditorStroke}
            oncontextmenu={(event) => event.preventDefault()}
          ></canvas>
          <label>Группа вариантов
            <input maxlength="80" value={selectedTile.variantGroup ?? ''} onchange={(event) => {
              variantGroup = event.currentTarget.value.trim();
              updateSelectedTile({ variantGroup: variantGroup || null });
            }} />
          </label>
          <label>Длительность кадра (мс)
            <input type="number" min="16" max="60000" bind:value={frameDuration} />
          </label>
          <button type="button" disabled={tilemap.tiles.length < 2} onclick={assignAnimation}>Анимировать всеми тайлами</button>
          {#if selectedTile.animation}
            <p>Кадров: {selectedTile.animation.frameTileIds.length}</p>
            <button type="button" onclick={() => updateSelectedTile({ animation: null })}>Убрать анимацию</button>
          {/if}
        {/if}
        {#if seamlessPreview}
          <h3>Бесшовное превью</h3>
          <canvas bind:this={previewCanvas} aria-label="Плиточный предпросмотр выбранного тайла"></canvas>
        {/if}
      </aside>
      <div class="map-area">
        <div class="map-layers" aria-label="Слои tilemap">
          <strong>Слои карты</strong>
          {#each tilemap.layers as layer (layer.id)}
            <div class="map-layer">
              <button type="button" class:active={layer.id === tilemap.activeLayerId}
                aria-pressed={layer.id === tilemap.activeLayerId}
                onclick={() => ontilemapchange({ ...tilemap, activeLayerId: layer.id })}>
                {layer.name}
              </button>
              <button type="button" aria-label={`${layer.visible ? 'Скрыть' : 'Показать'} слой ${layer.name}`}
                onclick={() => ontilemapchange({ ...tilemap, layers: tilemap.layers.map((entry) =>
                  entry.id === layer.id ? { ...entry, visible: !entry.visible } : entry,
                ) })}>{layer.visible ? '◉' : '○'}</button>
              <button type="button" aria-label={`${layer.locked ? 'Разблокировать' : 'Заблокировать'} слой ${layer.name}`}
                onclick={() => ontilemapchange({ ...tilemap, layers: tilemap.layers.map((entry) =>
                  entry.id === layer.id ? { ...entry, locked: !entry.locked } : entry,
                ) })}>{layer.locked ? '🔒' : '🔓'}</button>
            </div>
          {/each}
          <button type="button" onclick={addLayer}>Добавить слой</button>
        </div>
        <div class="map-scroll">
          <canvas bind:this={mapCanvas} style:width="{mapSize.width}px" style:height="{mapSize.height}px"
            class:fill-mode={fillMode} aria-label="Карта тайлов: щёлкните для размещения, перетащите для заливки"
            onpointerdown={onMapPointerDown} onpointermove={onMapPointerMove} onpointerup={onMapPointerUp}
            onpointercancel={cancelMapStroke}
          ></canvas>
        </div>
      </div>
    </div>
  {:else}
    <p>Создайте tileset из активного холста, задав размер одного тайла.</p>
  {/if}
</section>

<style>
  .tilemap-editor {
    position: absolute;
    inset: 0;
    z-index: 15;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--workspace, #34363f);
    color: var(--text, #f0f0f5);
  }
  header, .tilemap-toolbar, .map-layers {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px;
    background: var(--panel, #202128);
  }
  header { justify-content: space-between; }
  h2, h3 { margin: 0; font-size: 14px; }
  button, input, select {
    min-height: 28px;
    color: inherit;
    background: var(--panel-2, #2c2e37);
    border: 1px solid var(--border, #454752);
    border-radius: 4px;
  }
  button { padding: 4px 8px; cursor: pointer; }
  button.active, button.selected { border-color: var(--accent, #7c5cff); }
  input { width: 64px; padding: 4px; }
  label { display: flex; align-items: center; gap: 5px; font-size: 12px; }
  .tilemap-layout { display: grid; grid-template-columns: minmax(180px, 260px) minmax(0, 1fr); flex: 1; min-height: 0; }
  .tiles { display: flex; flex-direction: column; gap: 8px; padding: 8px; overflow: auto; border-right: 1px solid var(--border, #454752); }
  .tile-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 5px; }
  .tile-list button { display: grid; justify-items: center; gap: 3px; min-width: 0; }
  .tile-list canvas, .map-scroll canvas { image-rendering: pixelated; }
  .tile-pixel-editor {
    width: min(100%, 320px);
    height: auto;
    border: 1px solid var(--border, #454752);
    background-color: #777;
    background-image:
      linear-gradient(45deg, #999 25%, transparent 25%),
      linear-gradient(-45deg, #999 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #999 75%),
      linear-gradient(-45deg, transparent 75%, #999 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    image-rendering: pixelated;
    touch-action: none;
    cursor: crosshair;
  }
  .paint-colors { display: flex; flex-wrap: wrap; gap: 8px; font-size: 11px; }
  .paint-colors span { display: inline-flex; align-items: center; gap: 4px; }
  .paint-colors i { display: inline-block; width: 14px; height: 14px; border: 1px solid var(--border, #454752); }
  .tile-list span { max-width: 100%; overflow: hidden; font-size: 10px; text-overflow: ellipsis; }
  .map-area { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .map-layers { flex-shrink: 0; }
  .map-layer { display: flex; gap: 3px; }
  .map-scroll { flex: 1; min-width: 0; min-height: 0; overflow: auto; padding: 24px; }
  .map-scroll canvas { display: block; max-width: none; touch-action: none; cursor: crosshair; }
  .map-scroll canvas.fill-mode { cursor: cell; }
  .error { margin: 4px 12px; color: #ff7777; }
  @media (max-width: 700px) {
    .tilemap-layout { grid-template-columns: 1fr; grid-template-rows: minmax(120px, 30%) minmax(0, 1fr); }
    .tiles { border-right: 0; border-bottom: 1px solid var(--border, #454752); }
  }
</style>
