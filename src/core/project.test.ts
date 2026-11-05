import { describe, expect, it } from 'vitest';
import { getPalette, paletteIndexOf } from './palette';
import {
  ProjectFormatError,
  base64ToBytes,
  bytesToBase64,
  parseProject,
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
});
