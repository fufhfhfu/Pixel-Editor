/**
 * Ядро: кодировщик PNG (RGBA, 8 бит, без чересстрочности).
 *
 * Зачем свой кодировщик: canvas.toBlob() проходит через canvas, а тот хранит пиксели с
 * premultiplied-альфой. При a < 255 цвета искажаются (a=4: RGB (200,100,50) превращается
 * в (191,128,64)), а при a = 0 RGB теряется. Здесь байты пишутся как есть.
 */

export interface PngImage {
  width: number;
  height: number;
  /** RGBA, строка за строкой, длина width × height × 4. */
  data: Uint8ClampedArray;
}

export interface PngOptions {
  /** Не сжимать (сохранять deflate-блоками без сжатия). По умолчанию сжатие включено, если доступно. */
  stored?: boolean;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function adler32(bytes: Uint8Array): number {
  const MOD = 65521;
  const BLOCK = 5552; // наибольшее число байт, после которого сумма ещё не переполняет 32 бита
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; ) {
    const end = Math.min(i + BLOCK, bytes.length);
    for (; i < end; i++) {
      a += bytes[i];
      b += a;
    }
    a %= MOD;
    b %= MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 255;
  target[offset + 1] = (value >>> 16) & 255;
  target[offset + 2] = (value >>> 8) & 255;
  target[offset + 3] = value & 255;
}

/** zlib-поток из несжатых deflate-блоков: работает везде, но файл получается крупным. */
export function zlibStored(data: Uint8Array): Uint8Array {
  const MAX_BLOCK = 65535;
  const blocks = Math.max(1, Math.ceil(data.length / MAX_BLOCK));
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const from = b * MAX_BLOCK;
    const length = Math.min(MAX_BLOCK, data.length - from);
    out[o++] = b === blocks - 1 ? 1 : 0; // BFINAL, BTYPE = 00 (без сжатия)
    out[o++] = length & 255;
    out[o++] = length >>> 8;
    out[o++] = ~length & 255;
    out[o++] = (~length >>> 8) & 255;
    out.set(data.subarray(from, from + length), o);
    o += length;
  }
  writeUint32(out, o, adler32(data));
  return out;
}

/** zlib-поток с помощью CompressionStream, иначе без сжатия. */
async function zlibCompress(data: Uint8Array, stored: boolean): Promise<Uint8Array> {
  if (!stored && typeof CompressionStream === 'function') {
    try {
      const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // сжатие недоступно — падаем в несжатый режим
    }
  }
  return zlibStored(data);
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  writeUint32(out, 0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  writeUint32(out, 8 + payload.length, crc32(out, 4, 8 + payload.length));
  return out;
}

export async function encodePng(image: PngImage, options: PngOptions = {}): Promise<Uint8Array> {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Недопустимый размер изображения ${width}×${height}`);
  }
  if (data.length !== width * height * 4) {
    throw new RangeError('Длина данных не соответствует размеру изображения');
  }

  const header = new Uint8Array(13);
  writeUint32(header, 0, width);
  writeUint32(header, 4, height);
  header[8] = 8; // глубина 8 бит
  header[9] = 6; // RGBA
  // сжатие, фильтрация и чересстрочность — 0

  // Каждая строка начинается с байта фильтра 0 (без фильтрации)
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const compressed = await zlibCompress(raw, options.stored === true);
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', header), chunk('IDAT', compressed), chunk('IEND', new Uint8Array(0))];

  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
