import { describe, expect, it } from 'vitest';
import { getPalette, paletteIndexOf } from './palette';
import {
  ProjectFormatError,
  base64ToBytes,
  bytesToBase64,
  parseProject,
  parseProjectMetadataJson,
  serializeProject,
  type ProjectData,
} from './project';
import {
  AUTOSAVE_BACKUP_KEY,
  AUTOSAVE_KEY,
  loadAutosave,
  saveAutosave,
  type KeyValueStorage,
} from './storage';
import { createLayerEffect } from './effects';
import { createTilemap, sliceTileAtlas } from './tilemap';
import { createBrushDefinition } from './tools/brushLibrary';

function sample(): ProjectData {
  const pixels = new Uint8ClampedArray(5 * 4 * 4);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37) % 256;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] === 0) pixels[i] = 1; // без прозрачных: проверяем точность
  const p8 = getPalette('pico8');
  return {
    width: 5,
    height: 4,
    pixels,
    paletteId: 'pico8',
    freeColor: false,
    primary: p8.colors[8],
    secondary: p8.colors[7],
    recent: [p8.colors[8], p8.colors[2]],
  };
}

describe('проект JSON', () => {
  it('сохраняет кисти и расширяемые метаданные в версии 10', () => {
    const project: ProjectData = {
      ...sample(),
      brushes: [createBrushDefinition('Кисть проекта', 3, 'circle', 'custom')],
      metadata: {
        title: 'Пиксельный персонаж',
        custom: { author: 'Artist', tags: ['sprite', 'v10'], settings: [true, null, 3] },
      },
    };

    const serialized = serializeProject(project);
    const restored = parseProject(serialized);

    expect(JSON.parse(serialized).version).toBe(10);
    expect(restored.brushes).toEqual(project.brushes);
    expect(restored.metadata).toEqual(project.metadata);
  });

  it('сохраняет пользовательские палитры и выбранный цветовой режим в версии 11', () => {
    const project: ProjectData = {
      ...sample(),
      paletteId: 'custom-test-palette',
      customPalettes: [{
        id: 'custom-test-palette',
        name: 'Тестовая',
        colors: [{ r: 12, g: 34, b: 56, a: 255 }, { r: 78, g: 90, b: 123, a: 255 }],
      }],
    };
    const json = serializeProject(project);
    const restored = parseProject(json);
    expect(JSON.parse(json).version).toBe(11);
    expect(restored.customPalettes).toEqual(project.customPalettes);
    expect(restored.paletteId).toBe(project.paletteId);
  });

  it('сохраняет заметки проекта в версии 12', () => {
    const project = { ...sample(), notes: '# Идеи\n\nДобавить тени.' };
    const json = serializeProject(project);
    expect(JSON.parse(json).version).toBe(12);
    expect(parseProject(json).notes).toBe(project.notes);
    expect(parseProject(serializeProject(sample())).notes).toBeUndefined();
  });

  it('проверяет метаданные JSON до применения', () => {
    expect(parseProjectMetadataJson('{"title":"Sprite","tags":["game"]}')).toEqual({
      title: 'Sprite',
      tags: ['game'],
    });
    expect(() => parseProjectMetadataJson('[]')).toThrow(/объект/i);
    expect(() => parseProjectMetadataJson('{"constructor":true}')).toThrow(/метаданных/i);
  });

  it('отклоняет повреждённые кисти и небезопасные метаданные проекта', () => {
    const valid = JSON.parse(serializeProject({
      ...sample(),
      brushes: [createBrushDefinition('Valid', 2)],
      metadata: { title: 'Valid' },
    }));
    const invalidBrushes = structuredClone(valid);
    invalidBrushes.brushes[0].mask = [1];
    expect(() => parseProject(JSON.stringify(invalidBrushes))).toThrow(ProjectFormatError);

    const invalidMetadata = structuredClone(valid);
    invalidMetadata.metadata = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(() => parseProject(JSON.stringify(invalidMetadata))).toThrow(/метаданных/i);

    expect(() => serializeProject({ ...sample(), metadata: { value: Number.POSITIVE_INFINITY } }))
      .toThrow(/метаданных/i);
  });

  it('сохранение и загрузка без потерь', () => {
    const p = sample();
    const q = parseProject(serializeProject(p));
    expect(q.width).toBe(5);
    expect(q.height).toBe(4);
    expect(Array.from(q.pixels)).toEqual(Array.from(p.pixels));
    expect(q.paletteId).toBe('pico8');
    expect(q.primary).toEqual(p.primary);
    expect(q.secondary).toEqual(p.secondary);
    expect(q.recent).toEqual(p.recent);
    expect(q.canvases).toBeUndefined();
  });

  it('сохраняет кадры анимации и проверяет их размер и уникальные идентификаторы', () => {
    const project = sample();
    const animationProject = {
      ...project,
      animationFrames: [
        { id: 'frame-a', durationMs: 100, pixels: project.pixels },
        { id: 'frame-b', durationMs: 250, pixels: new Uint8ClampedArray(project.pixels.length).fill(75) },
      ],
    };
    const serialized = serializeProject(animationProject);
    const restored = parseProject(serialized);

    expect(JSON.parse(serialized).version).toBe(9);
    expect(restored.animationFrames?.map(({ id, durationMs }) => ({ id, durationMs }))).toEqual([
      { id: 'frame-a', durationMs: 100 },
      { id: 'frame-b', durationMs: 250 },
    ]);
    expect(Array.from(restored.animationFrames![1]!.pixels)).toEqual(
      Array.from(animationProject.animationFrames[1]!.pixels),
    );

    expect(() => serializeProject({
      ...project,
      animationFrames: [
        { id: 'duplicate', durationMs: 100, pixels: project.pixels },
        { id: 'duplicate', durationMs: 100, pixels: project.pixels },
      ],
    })).toThrow(ProjectFormatError);
  });

  it('сохраняет независимые кадры каждого слоя в формате версии 9', () => {
    const project = sample();
    const layerFrames = [
      { id: 'cel-1', durationMs: 100, pixels: project.pixels },
      { id: 'cel-2', durationMs: 180, pixels: new Uint8ClampedArray(project.pixels.length).fill(22) },
    ];
    const layeredProject: ProjectData = {
      ...project,
      canvases: [{
        id: 'canvas',
        x: 0,
        y: 0,
        width: project.width,
        height: project.height,
        pixels: project.pixels,
        activeLayerId: 'layer',
        layers: [{
          id: 'layer',
          name: 'Layer',
          pixels: project.pixels,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          alphaLock: false,
          clippingMask: false,
          animationFrames: layerFrames,
        }],
      }],
      activeCanvasId: 'canvas',
    };

    const restored = parseProject(serializeProject(layeredProject));
    const frames = restored.canvases?.[0]?.layers?.[0]?.animationFrames;
    expect(frames?.map(({ id, durationMs }) => ({ id, durationMs }))).toEqual([
      { id: 'cel-1', durationMs: 100 },
      { id: 'cel-2', durationMs: 180 },
    ]);
    expect(Array.from(frames![1]!.pixels)).toEqual(Array.from(layerFrames[1]!.pixels));
  });

  it('сохраняет и восстанавливает несколько холстов с активным холстом и позициями', () => {
    const first = sample();
    const second = {
      ...sample(),
      width: 3,
      height: 2,
      pixels: new Uint8ClampedArray(3 * 2 * 4).fill(93),
    };
    const multi: ProjectData = {
      ...first,
      canvases: [
        { id: 'left', x: -12, y: 4, width: first.width, height: first.height, pixels: first.pixels },
        { id: 'right', x: 24, y: -8, width: second.width, height: second.height, pixels: second.pixels },
      ],
      activeCanvasId: 'right',
    };

    const restored = parseProject(serializeProject(multi));
    expect(restored.canvases?.map(({ id, x, y, width, height }) => ({ id, x, y, width, height }))).toEqual([
      { id: 'left', x: -12, y: 4, width: 5, height: 4 },
      { id: 'right', x: 24, y: -8, width: 3, height: 2 },
    ]);
    expect(restored.activeCanvasId).toBe('right');
    expect([restored.width, restored.height]).toEqual([3, 2]);
    expect(Array.from(restored.canvases![1]!.pixels)).toEqual(Array.from(second.pixels));
  });

  it('сохраняет группы, роли, эффекты и независимые пиксели в версии 5 формата', () => {
    const base = sample();
    const topPixels = new Uint8ClampedArray(base.pixels.length);
    topPixels.set([1, 2, 3, 255]);
    const project: ProjectData = {
      ...base,
      canvases: [{
        id: 'canvas',
        x: 0,
        y: 0,
        width: base.width,
        height: base.height,
        pixels: base.pixels,
        layers: [
          {
            id: 'base',
            name: 'Фон',
            pixels: base.pixels,
            visible: true,
            locked: true,
            opacity: 1,
            blendMode: 'normal',
            alphaLock: false,
            clippingMask: false,
            role: 'background',
            effects: { brightness: 0, contrast: 0, saturation: 0 },
          },
          {
            id: 'top',
            name: 'Детали',
            pixels: topPixels,
            visible: false,
            locked: false,
            opacity: 0.6,
            blendMode: 'multiply',
            alphaLock: true,
            clippingMask: true,
            role: 'reference',
            effects: { brightness: 0, contrast: 0, saturation: -100 },
            groupId: 'inner',
          },
        ],
        groups: [
          {
            id: 'outer',
            name: 'Персонаж',
            parentGroupId: null,
            visible: true,
            locked: false,
            opacity: 0.8,
            blendMode: 'normal',
            effects: { brightness: 0, contrast: 0, saturation: 0 },
          },
          {
            id: 'inner',
            name: 'Детали',
            parentGroupId: 'outer',
            visible: true,
            locked: false,
            opacity: 0.9,
            blendMode: 'multiply',
            effects: { brightness: 5, contrast: 10, saturation: -20 },
          },
        ],
        activeLayerId: 'top',
      }],
      activeCanvasId: 'canvas',
    };
    const json = serializeProject(project);
    expect(JSON.parse(json).version).toBe(5);
    const restored = parseProject(json);
    expect(restored.canvases?.[0]?.layers?.map(({ id, name, visible, locked, opacity, blendMode, alphaLock, clippingMask, role, effects, groupId }) =>
      ({ id, name, visible, locked, opacity, blendMode, alphaLock, clippingMask, role, effects, groupId }))).toEqual([
      {
        id: 'base', name: 'Фон', visible: true, locked: true, opacity: 1,
        blendMode: 'normal', alphaLock: false, clippingMask: false,
        role: 'background', effects: { brightness: 0, contrast: 0, saturation: 0 },
        groupId: null,
      },
      {
        id: 'top', name: 'Детали', visible: false, locked: false, opacity: 0.6,
        blendMode: 'multiply', alphaLock: true, clippingMask: true,
        role: 'reference', effects: { brightness: 0, contrast: 0, saturation: -100 },
        groupId: 'inner',
      },
    ]);
    expect(restored.canvases?.[0]?.groups).toEqual(project.canvases?.[0]?.groups);
    expect(restored.canvases?.[0]?.layers?.[1]?.pixels).toEqual(topPixels);
    expect(restored.canvases?.[0]?.activeLayerId).toBe('top');
    expect(restored.canvases?.[0]?.pixels).toEqual(base.pixels);
    const v4 = JSON.parse(json) as Record<string, unknown>;
    v4.version = 4;
    const legacyCanvas = (v4.canvases as Array<Record<string, unknown>>)[0]!;
    delete legacyCanvas.groups;
    for (const layer of legacyCanvas.layers as Array<Record<string, unknown>>) delete layer.groupId;
    const migratedV4 = parseProject(JSON.stringify(v4));
    expect(migratedV4.canvases?.[0]?.groups).toEqual([]);
    expect(migratedV4.canvases?.[0]?.layers?.map((layer) => layer.groupId)).toEqual([null, null]);
    expect(() => serializeProject({
      ...project,
      canvases: project.canvases?.map((canvas) => ({
        ...canvas,
        groups: canvas.groups?.map((group) => ({
          ...group,
          parentGroupId: group.id === 'outer' ? 'inner' : 'outer',
        })),
      })),
    })).toThrow(/цикл/);
    expect(() => serializeProject({
      ...project,
      canvases: project.canvases?.map((canvas) => ({ ...canvas, activeLayerId: 'missing' })),
    })).toThrow(/неизвестный активный слой/);
  });

  it('сохраняет стек неразрушающих эффектов слоя в версии 7 формата', () => {
    const base = sample();
    const filters = [
      { ...createLayerEffect('outline', 'outline-1'), radius: 3 },
      { ...createLayerEffect('noise', 'noise-1'), enabled: false, amount: 24, seed: 9876 },
    ];
    const project: ProjectData = {
      ...base,
      canvases: [{
        id: 'canvas',
        x: 0,
        y: 0,
        width: base.width,
        height: base.height,
        pixels: base.pixels,
        layers: [{
          id: 'layer',
          name: 'Эффекты',
          pixels: base.pixels,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          alphaLock: false,
          clippingMask: false,
          filters,
        }],
      }],
      activeCanvasId: 'canvas',
    };

    const json = serializeProject(project);
    expect(JSON.parse(json).version).toBe(7);
    const restored = parseProject(json);
    expect(restored.canvases?.[0]?.layers?.[0]?.filters).toEqual(filters);

    const legacy = JSON.parse(json) as Record<string, unknown>;
    legacy.version = 6;
    const canvas = (legacy.canvases as Array<Record<string, unknown>>)[0]!;
    const layer = (canvas.layers as Array<Record<string, unknown>>)[0]!;
    delete layer.filters;
    expect(parseProject(JSON.stringify(legacy)).canvases?.[0]?.layers?.[0]?.filters).toEqual([]);
  });

  it('сохраняет и проверяет референсы в версии 6 проекта', () => {
    const project = sample();
    const reference = {
      id: 'ref-1',
      name: 'character.png',
      width: 2,
      height: 1,
      pixels: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]),
      x: -12,
      y: 35,
      scale: 1.5,
      rotation: 90,
      opacity: 0.4,
      visible: false,
      locked: true,
    };
    const json = serializeProject({ ...project, references: [reference] });
    expect(JSON.parse(json).version).toBe(6);
    const restored = parseProject(json);
    expect(restored.references).toEqual([reference]);

    const raw = JSON.parse(json) as { references: Array<Record<string, unknown>> };
    raw.references[0]!.opacity = 2;
    expect(() => parseProject(JSON.stringify(raw))).toThrow(ProjectFormatError);
    expect(() => serializeProject({ ...project, references: [{ ...reference, id: '' }] })).toThrow(ProjectFormatError);
    expect(() => serializeProject({ ...project, references: [reference, { ...reference }] })).toThrow(/некорректные данные референса/);
  });

  it('сохраняет референсы с несколькими холстами без слоёв', () => {
    const base = sample();
    const reference = {
      id: 'ref',
      name: 'ref.png',
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray([40, 50, 60, 255]),
      x: 4,
      y: 8,
      scale: 1,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    };
    const project: ProjectData = {
      ...base,
      canvases: [{
        id: 'canvas',
        x: 0,
        y: 0,
        width: base.width,
        height: base.height,
        pixels: base.pixels,
      }, {
        id: 'canvas-2',
        x: 40,
        y: 0,
        width: 3,
        height: 2,
        pixels: new Uint8ClampedArray(3 * 2 * 4),
      }],
      references: [reference],
    };
    const restored = parseProject(serializeProject(project));
    expect(restored.canvases?.[0]?.pixels).toEqual(base.pixels);
    expect(restored.references).toEqual([reference]);
  });

  it('мигрирует v3 слои к типу paint и нейтральным эффектам', () => {
    const project = sample();
    const json = serializeProject({
      ...project,
      canvases: [{
        id: 'canvas',
        x: 0,
        y: 0,
        width: project.width,
        height: project.height,
        pixels: project.pixels,
        layers: [{
          id: 'layer',
          name: 'Слой',
          pixels: project.pixels,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          alphaLock: false,
          clippingMask: false,
        }],
      }],
    });
    const v3 = JSON.parse(json) as Record<string, unknown>;
    v3.version = 3;
    const canvas = (v3.canvases as Array<Record<string, unknown>>)[0]!;
    const layers = canvas.layers as Array<Record<string, unknown>>;
    delete layers[0]!.role;
    delete layers[0]!.effects;

    const restored = parseProject(JSON.stringify(v3));
    expect(restored.canvases?.[0]?.layers?.[0]?.role).toBe('paint');
    expect(restored.canvases?.[0]?.layers?.[0]?.effects)
      .toEqual({ brightness: 0, contrast: 0, saturation: 0 });
  });

  it('отклоняет повторяющиеся идентификаторы холстов', () => {
    const canvas = {
      id: 'same',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray(4),
    };
    const project: ProjectData = {
      ...sample(),
      canvases: [canvas, { ...canvas }],
      activeCanvasId: 'same',
    };
    expect(() => parseProject(serializeProject(project))).toThrow(/повторяется идентификатор/);
  });

  it('свободный режим хранит произвольные цвета как есть', () => {
    const f = { ...sample(), freeColor: true, primary: { r: 1, g: 2, b: 3, a: 200 } };
    const q = parseProject(serializeProject(f));
    expect(q.freeColor).toBe(true);
    expect(q.primary).toEqual({ r: 1, g: 2, b: 3, a: 200 });
  });

  it('режим палитры приводит «чужой» цвет из файла к палитре', () => {
    const raw = JSON.parse(serializeProject(sample()));
    raw.colors.primary = [1, 2, 3, 255];
    expect(paletteIndexOf(getPalette('pico8'), parseProject(JSON.stringify(raw)).primary)).toBeGreaterThanOrEqual(0);
  });

  it('неизвестная палитра и битые цвета не валят загрузку', () => {
    const raw = JSON.parse(serializeProject(sample()));
    raw.palette.id = 'nope';
    raw.colors = { primary: 'x' };
    raw.recent = [[1, 2, 3, 4], 'bad', [999, 0, 0, 0]];
    const q = parseProject(JSON.stringify(raw));
    expect(q.paletteId).toBe('pico8');
    expect(q.recent).toHaveLength(1);
  });

  it('холст 512×512 проходит туда и обратно', () => {
    const big: ProjectData = {
      ...sample(),
      width: 512,
      height: 512,
      pixels: new Uint8ClampedArray(512 * 512 * 4).fill(171),
    };
    const text = serializeProject(big);
    expect(text.length).toBeLessThan(2_000_000);
    const restored = parseProject(text);
    expect([restored.width, restored.height]).toEqual([512, 512]);
    expect(Array.from(restored.pixels.slice(0, 8))).toEqual(Array.from(big.pixels.slice(0, 8)));
    expect(Array.from(restored.pixels.slice(-8))).toEqual(Array.from(big.pixels.slice(-8)));
  });

  it('base64 корректен на всех значениях байта', () => {
    const all = new Uint8ClampedArray(256 * 3 + 1).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(all))).toEqual(all);
  });

  it('сохраняет tilemap и пиксели тайлов в версии 8 формата', () => {
    const project = sample();
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    pixels.fill(127);
    const tiles = sliceTileAtlas(pixels, 4, 4, 2, 2);
    const tilemap = {
      ...createTilemap(3, 2, 2, 2, 'hexagonal'),
      tiles,
      layers: [{
        id: 'ground',
        name: 'Ground',
        visible: true,
        locked: false,
        cells: ['tile-1', null, 'tile-2', null, 'tile-1', 'tile-2'],
      }],
      activeLayerId: 'ground',
    };
    const json = serializeProject({ ...project, tilemap });
    expect(JSON.parse(json).version).toBe(8);
    const restored = parseProject(json);
    expect(restored.tilemap?.grid).toBe('hexagonal');
    expect(restored.tilemap?.layers[0]?.cells).toEqual(tilemap.layers[0]!.cells);
    expect(restored.tilemap?.tiles.map((tile) => [...tile.pixels])).toEqual(tiles.map((tile) => [...tile.pixels]));
  });

  it('отклоняет tilemap со ссылками на отсутствующие тайлы и повреждёнными пикселями', () => {
    const project = sample();
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    const [tile] = sliceTileAtlas(pixels, 4, 4, 2, 2);
    const invalidMap = {
      ...createTilemap(1, 1, 2, 2),
      tiles: [tile!],
      layers: [{
        id: 'ground',
        name: 'Ground',
        visible: true,
        locked: false,
        cells: ['missing-tile'],
      }],
      activeLayerId: 'ground',
    };
    expect(() => serializeProject({ ...project, tilemap: invalidMap })).toThrow(ProjectFormatError);

    const validMap = {
      ...invalidMap,
      layers: [{ ...invalidMap.layers[0]!, cells: ['tile-1'] }],
    };
    const parsed = JSON.parse(serializeProject({ ...project, tilemap: validMap })) as {
      tilemap: { tiles: Array<{ pixels: string }> };
    };
    parsed.tilemap.tiles[0]!.pixels = 'broken';
    expect(() => parseProject(JSON.stringify(parsed))).toThrow(ProjectFormatError);
  });

  it('BUG-B: прозрачные пиксели со спрятанным RGB при загрузке приводятся к (0,0,0,0)', () => {
    const p = sample();
    p.pixels.fill(0);
    p.pixels.set([9, 9, 9, 0], 0);
    const q = parseProject(serializeProject(p));
    expect(Array.from(q.pixels.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it('понятные ошибки для испорченных файлов', () => {
    const good = JSON.parse(serializeProject(sample()));
    const bad = (mutate: (o: Record<string, unknown>) => void): string => {
      const o = structuredClone(good);
      mutate(o);
      return JSON.stringify(o);
    };
    const fails = (text: string, re: RegExp) =>
      expect(() => parseProject(text)).toThrowError(
        expect.objectContaining({ name: 'ProjectFormatError', message: expect.stringMatching(re) }),
      );

    fails('{не json', /JSON/);
    fails('[]', /не файл проекта/);
    fails('null', /не файл проекта/);
    fails(bad((o) => (o.format = 'other')), /не файл проекта/);
    fails(bad((o) => delete o.version), /версия/);
    fails(bad((o) => (o.version = 99)), /новой версии/);
    fails(bad((o) => (o.width = 0)), /размер/);
    fails(bad((o) => (o.height = 5000)), /размер/);
    fails(bad((o) => (o.width = 2.5)), /размер/);
    fails(bad((o) => (o.pixels = 'AAAA')), /повреждены/);
    fails(bad((o) => (o.pixels = '!'.repeat((o.pixels as string).length))), /повреждены/);
    fails('x'.repeat(33 * 1024 * 1024), /большой/);
    expect(new ProjectFormatError('x')).toBeInstanceOf(Error);
  });
});

describe('автосохранение', () => {
  const memory = () => {
    const mem = new Map<string, string>();
    const storage: KeyValueStorage = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
    return { mem, storage };
  };

  it('пустое хранилище, запись и чтение', () => {
    const { storage } = memory();
    expect(loadAutosave(storage)).toEqual({ project: null, error: null });
    const p = sample();
    expect(saveAutosave(storage, p)).toBe(true);
    const r = loadAutosave(storage);
    expect(r.error).toBeNull();
    expect(Array.from(r.project!.pixels)).toEqual(Array.from(p.pixels));
  });

  it('повреждённое сохранение: сообщение и копия в запасном ключе', () => {
    const { mem, storage } = memory();
    const broken = '{"format":"pixel-editor-project","version":1,"width":3';
    mem.set(AUTOSAVE_KEY, broken);
    const r = loadAutosave(storage);
    expect(r.project).toBeNull();
    expect(r.error).toMatch(/Не удалось восстановить/);
    expect(mem.get(AUTOSAVE_BACKUP_KEY)).toBe(broken);
  });

  it('переполнение квоты и закрытое хранилище', () => {
    const full: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem() {},
    };
    expect(saveAutosave(full, sample())).toBe(false);
    const closed: KeyValueStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem() {},
      removeItem() {},
    };
    expect(loadAutosave(closed).error).toMatch(/недоступно/);
  });

  it('считает запись несохранённой, если localStorage не подтверждает сохранённые байты', () => {
    const storage: KeyValueStorage = {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    };
    expect(saveAutosave(storage, sample())).toBe(false);
  });
});
