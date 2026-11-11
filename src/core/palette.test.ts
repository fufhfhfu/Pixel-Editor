import { describe, expect, it } from 'vitest';
import { rgbaToCss, rgbaToHex, hexToRgba } from './color';
import {
  DEFAULT_PALETTE_ID,
  MAX_RECENT_COLORS,
  MAX_CUSTOM_PALETTES,
  PALETTES,
  colorsEqual,
  constrainColor,
  filterToPalette,
  getPalette,
  nearestPaletteColor,
  paletteIndexOf,
  pushRecentColor,
  parseCustomPalettes,
} from './palette';

describe('палитры', () => {
  it('проверяет и принимает пользовательские палитры проекта', () => {
    const palette = {
      id: 'custom-test',
      name: 'Тестовая',
      colors: [{ r: 10, g: 20, b: 30, a: 255 }],
    };
    expect(parseCustomPalettes([palette])).toMatchObject([palette]);
    expect(() => parseCustomPalettes([{ ...palette, id: 'pico8' }])).toThrow();
    expect(() => parseCustomPalettes([{ ...palette, colors: [] }])).toThrow();
    expect(() => parseCustomPalettes(Array.from({ length: MAX_CUSTOM_PALETTES + 1 }, (_, index) => ({
      ...palette,
      id: `custom-${index}`,
    })))).toThrow(/не больше/i);
  });

  it('размеры пресетов и отсутствие дубликатов', () => {
    const counts = Object.fromEntries(PALETTES.map((p) => [p.id, p.colors.length]));
    expect(counts).toEqual({
      gameboy: 4,
      pico8: 16,
      nes: 54,
      ega: 16,
      fantasy32: 32,
      pastel32: 32,
      cardart160: 160,
    });
    for (const p of PALETTES) {
      const hex = p.colors.map(rgbaToHex);
      expect(new Set(hex).size).toBe(hex.length);
      expect(p.colors.every((c) => c.a === 255)).toBe(true);
    }
    expect(getPalette(DEFAULT_PALETTE_ID)).toBeTruthy();
    expect(() => getPalette('nope')).toThrow();
  });

  it('палитра Card Art имеет 20 подписанных тональных рамп по 8 оттенков', () => {
    const cardArt = getPalette('cardart160');
    expect(cardArt.groups).toHaveLength(20);
    expect(cardArt.groups?.every((group) => group.colors.length === 8)).toBe(true);
    expect(cardArt.groups?.map((group) => group.name)).toContain('Магический циан');
    expect(cardArt.colors).toContainEqual(hexToRgba('#ffdf83'));
    expect(cardArt.colors).toContainEqual(hexToRgba('#1e7188'));
    expect(cardArt.colors).toContainEqual(hexToRgba('#d9ed86'));
  });

  it('ближайший цвет: точное и приближённое попадание, результат непрозрачный', () => {
    const pico = getPalette('pico8');
    expect(rgbaToHex(nearestPaletteColor(pico, hexToRgba('#ff004d')!))).toBe('#ff004d');
    expect(rgbaToHex(nearestPaletteColor(pico, hexToRgba('#fe0050')!))).toBe('#ff004d');
    const gb = getPalette('gameboy');
    expect(rgbaToHex(nearestPaletteColor(gb, hexToRgba('#ffffff')!))).toBe('#9bbc0f');
    expect(rgbaToHex(nearestPaletteColor(gb, hexToRgba('#000000')!))).toBe('#0f380f');
    expect(nearestPaletteColor(gb, { r: 10, g: 60, b: 10, a: 90 }).a).toBe(255);
  });

  it('constrainColor: режим палитры всегда даёт цвет палитры, свободный — цвет как есть', () => {
    const pico = getPalette('pico8');
    const odd = { r: 123, g: 45, b: 67, a: 255 };
    expect(paletteIndexOf(pico, constrainColor(pico, odd, false))).toBeGreaterThanOrEqual(0);
    expect(constrainColor(pico, odd, true)).toBe(odd);
  });

  it('недавние: порядок, без повторов, не больше лимита', () => {
    const pico = getPalette('pico8');
    let r = pushRecentColor([], pico.colors[1]);
    r = pushRecentColor(r, pico.colors[2]);
    r = pushRecentColor(r, pico.colors[1]);
    expect(r.map(rgbaToHex)).toEqual([rgbaToHex(pico.colors[1]), rgbaToHex(pico.colors[2])]);
    let many: ReturnType<typeof pushRecentColor> = [];
    for (let i = 0; i < 40; i++) many = pushRecentColor(many, { r: i, g: 0, b: 0, a: 255 });
    expect(many.length).toBe(MAX_RECENT_COLORS);
    expect(many[0].r).toBe(39);
  });

  it('фильтр по палитре и сравнение цветов', () => {
    const pico = getPalette('pico8');
    const mixed = [pico.colors[3], { r: 123, g: 45, b: 67, a: 255 }, pico.colors[5]];
    expect(filterToPalette(mixed, pico).length).toBe(2);
    expect(filterToPalette(mixed, getPalette('gameboy')).length).toBe(0);
    expect(colorsEqual(pico.colors[3], { ...pico.colors[3] })).toBe(true);
    expect(rgbaToCss({ r: 1, g: 2, b: 3, a: 255 })).toBe('rgba(1, 2, 3, 1)');
  });
});
