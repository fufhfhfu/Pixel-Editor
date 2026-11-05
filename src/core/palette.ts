import type { RGBA } from './state';

export type ColorSlot = 'primary' | 'secondary';

export interface Palette {
  readonly id: string;
  readonly name: string;
  readonly colors: readonly RGBA[];
  readonly groups?: readonly PaletteGroup[];
}

export interface PaletteGroup {
  readonly name: string;
  readonly colors: readonly RGBA[];
}

const color = (hex: string): RGBA => {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return { r: value >>> 16, g: (value >>> 8) & 255, b: value & 255, a: 255 };
};

const palette = (id: string, name: string, colors: readonly string[]): Palette =>
  Object.freeze({ id, name, colors: Object.freeze(colors.map(color)) });

const groupedPalette = (
  id: string,
  name: string,
  groups: readonly (readonly [string, readonly string[]])[],
): Palette => {
  const colorGroups = groups.map(([groupName, values]) =>
    Object.freeze({ name: groupName, colors: Object.freeze(values.map(color)) }),
  );
  return Object.freeze({
    id,
    name,
    groups: Object.freeze(colorGroups),
    colors: Object.freeze(colorGroups.flatMap((group) => group.colors)),
  });
};

export const PALETTES: readonly Palette[] = Object.freeze([
  palette('gameboy', 'Game Boy', ['#0f380f', '#306230', '#8bac0f', '#9bbc0f']),
  palette('pico8', 'PICO-8', [
    '#000000', '#1d2b53', '#7e2553', '#008751',
    '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
    '#ff004d', '#ffa300', '#ffec27', '#00e436',
    '#29adff', '#83769c', '#ff77a8', '#ffccaa',
  ]),
  palette('nes', 'NES', [
    '#7c7c7c', '#0000fc', '#0000bc', '#4428bc', '#940084', '#a80020',
    '#a81000', '#881400', '#503000', '#007800', '#006800', '#005800',
    '#004058', '#000000', '#bcbcbc', '#0078f8', '#0058f8', '#6844fc',
    '#d800cc', '#e40058', '#f83800', '#e45c10', '#ac7c00', '#00b800',
    '#00a800', '#00a844', '#008888', '#080808', '#f8f8f8', '#3cbcfc',
    '#6888fc', '#9878f8', '#f878f8', '#f85898', '#f87858', '#fca044',
    '#f8b800', '#b8f818', '#58d854', '#58f898', '#00e8d8', '#787878',
    '#fcfcfc', '#a4e4fc', '#b8b8f8', '#d8b8f8', '#f8b8f8', '#f8a4c0',
    '#f0d0b0', '#fce0a8', '#f8d878', '#d8f878', '#b8f8b8', '#b8f8d8',
  ]),
  palette('ega', 'EGA', [
    '#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa',
    '#aa5500', '#aaaaaa', '#555555', '#5555ff', '#55ff55', '#55ffff',
    '#ff5555', '#ff55ff', '#ffff55', '#ffffff',
  ]),
  palette('fantasy32', 'Fantasy · 32', [
    '#151a2e', '#303852', '#59627a', '#9aa3b5',
    '#4a2937', '#874553', '#d17a72', '#f2b89a',
    '#4b1f3a', '#8e3156', '#d64d66', '#fa8b78',
    '#61354a', '#9e4b38', '#e47a3e', '#ffc15a',
    '#302839', '#665044', '#a87955', '#e0b47e',
    '#1e3d45', '#32705b', '#69a867', '#b8d575',
    '#1d3658', '#315f89', '#5796b6', '#9bd5d0',
    '#352b58', '#604783', '#9870b3', '#d2a4d6',
  ]),
  palette('pastel32', 'Pastel · 32', [
    '#202735', '#39445a', '#59677a', '#7b8b99',
    '#a4b1b8', '#c7d0cd', '#e4e6d8', '#fff5dc',
    '#482d3d', '#784454', '#ad6270', '#d98787',
    '#f0ad9c', '#ffd0aa', '#ffe6bd', '#fff2d6',
    '#193b43', '#27605b', '#3f8670', '#68a982',
    '#9ac391', '#c7d89e', '#e5e8ad', '#fcf0b5',
    '#23395b', '#345b7e', '#4f80a0', '#77a6b8',
    '#a6c8c8', '#c8d6dd', '#b9b2d1', '#938dbd',
  ]),
  groupedPalette('cardart160', 'Card Art · 160', [
    ['Чернила и тени', [
      '#10131d', '#171d2a', '#202735', '#2c3442',
      '#3b4653', '#53616c', '#74838b', '#a0acac',
    ]],
    ['Холодный камень', [
      '#242834', '#343746', '#484b5c', '#5f6372',
      '#7a7f8e', '#999eaa', '#b9bec5', '#d9d9d6',
    ]],
    ['Тёплый фарфор', [
      '#392a27', '#59443b', '#796050', '#9d7e66',
      '#bd9e7f', '#d8bda0', '#eddbc0', '#fff1d9',
    ]],
    ['Светлая кожа', [
      '#50302b', '#77463a', '#a35f4b', '#c77b60',
      '#df9976', '#efb895', '#f8d3b0', '#fff0d7',
    ]],
    ['Золотистая кожа', [
      '#40261f', '#653923', '#89502e', '#ad6c3e',
      '#c98c55', '#dfad73', '#f0ca98', '#ffe6bd',
    ]],
    ['Глубокая кожа', [
      '#24171b', '#3d2225', '#5a3030', '#79413a',
      '#995646', '#b9745b', '#d49a78', '#edc09b',
    ]],
    ['Вино и тени ткани', [
      '#211729', '#342036', '#4b2b45', '#66354e',
      '#854254', '#a65560', '#c87578', '#e7a19a',
    ]],
    ['Малиновый акцент', [
      '#321426', '#521b32', '#75243c', '#9c3046',
      '#c23d4c', '#e25459', '#f47a70', '#ffad91',
    ]],
    ['Алый и коралловый', [
      '#391c1c', '#61251d', '#8c3020', '#b94227',
      '#d95b31', '#ed7950', '#fa9d72', '#ffc49a',
    ]],
    ['Золото', [
      '#392313', '#583015', '#79421a', '#9f571e',
      '#c27425', '#e29630', '#f5b944', '#ffdf83',
    ]],
    ['Янтарь и свет', [
      '#332017', '#593019', '#82431b', '#ae5d21',
      '#d27d2c', '#ed9e3e', '#ffc45b', '#ffe49a',
    ]],
    ['Кожа и дерево', [
      '#281d1b', '#403027', '#5b4332', '#78583b',
      '#98734b', '#b28c5e', '#cdae7e', '#e5d0a6',
    ]],
    ['Медь и ржавчина', [
      '#301b1a', '#4d2720', '#713326', '#95452b',
      '#b65e35', '#d27b49', '#e9a06a', '#f6c391',
    ]],
    ['Лесная зелень', [
      '#101d1c', '#172b25', '#21402c', '#2e5734',
      '#427342', '#5c9150', '#82ad65', '#b2ca81',
    ]],
    ['Листва и лайм', [
      '#182219', '#26371e', '#385326', '#4e7130',
      '#6b913a', '#8cb348', '#b3d45d', '#d9ed86',
    ]],
    ['Мята и нефрит', [
      '#142723', '#1d4035', '#285b45', '#377857',
      '#4a966a', '#69b37e', '#92ce9b', '#c2e6bd',
    ]],
    ['Морская бирюза', [
      '#11232a', '#153b43', '#1c555b', '#246e70',
      '#318985', '#49a79b', '#71c5b2', '#a9dfca',
    ]],
    ['Магический циан', [
      '#10212d', '#123748', '#17546a', '#1e7188',
      '#278fa2', '#37acb5', '#63cbd0', '#a1e9e4',
    ]],
    ['Сапфир и небо', [
      '#151c31', '#1d2b48', '#293d64', '#34547f',
      '#426f99', '#5a91b2', '#83b8cc', '#c1e0df',
    ]],
    ['Индиго и аметист', [
      '#1b1830', '#292344', '#3b315e', '#514277',
      '#6a5790', '#8873a9', '#b09ac5', '#ddc5de',
    ]],
  ]),
]);

export const DEFAULT_PALETTE_ID = 'pico8';
export const MAX_RECENT_COLORS = 12;

export function getPalette(id: string): Palette {
  const found = PALETTES.find((entry) => entry.id === id);
  if (!found) throw new RangeError(`Неизвестная палитра: ${id}`);
  return found;
}

export function colorsEqual(a: RGBA, b: RGBA): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

export function paletteIndexOf(palette: Palette, color: RGBA): number {
  return palette.colors.findIndex((entry) => colorsEqual(entry, color));
}

export function nearestPaletteColor(palette: Palette, value: RGBA): RGBA {
  let best = palette.colors[0];
  if (!best) throw new RangeError(`Палитра «${palette.id}» не содержит цветов.`);

  let bestDistance = Infinity;
  for (const candidate of palette.colors) {
    const r = candidate.r - value.r;
    const g = candidate.g - value.g;
    const b = candidate.b - value.b;
    const distance = 2 * r * r + 4 * g * g + 3 * b * b;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function constrainColor(palette: Palette, value: RGBA, freeColor: boolean): RGBA {
  return freeColor ? value : nearestPaletteColor(palette, value);
}

export function filterToPalette(colors: readonly RGBA[], palette: Palette): RGBA[] {
  return colors.filter((value) => paletteIndexOf(palette, value) >= 0);
}

export function pushRecentColor(colors: readonly RGBA[], value: RGBA): RGBA[] {
  return [value, ...colors.filter((entry) => !colorsEqual(entry, value))].slice(0, MAX_RECENT_COLORS);
}
