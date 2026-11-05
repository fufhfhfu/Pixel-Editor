const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const content = Buffer.concat([typeBuffer, data]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(content));
  return Buffer.concat([header, content, checksum]);
}

function iconPng(size) {
  const rows = [];
  const inset = Math.max(1, Math.floor(size / 32));
  const padding = Math.floor((size * 5) / 32);
  const gap = Math.max(1, Math.floor((size * 2) / 32));
  const tile = Math.floor((size - padding * 2 - gap) / 2);
  const dark = [17, 18, 26, 255];
  const purple = [115, 83, 232, 255];
  const gray = [71, 75, 90, 255];
  const transparent = [0, 0, 0, 0];

  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      let color = x >= inset && x < size - inset && y >= inset && y < size - inset ? dark : transparent;
      if (color === dark) {
        const col = Math.floor((x - padding) / (tile + gap));
        const line = Math.floor((y - padding) / (tile + gap));
        const localX = (x - padding) % (tile + gap);
        const localY = (y - padding) % (tile + gap);
        if (col >= 0 && col < 2 && line >= 0 && line < 2 && localX < tile && localY < tile) {
          color = col === line ? purple : gray;
        }
      }
      color.forEach((channel, index) => {
        row[1 + x * 4 + index] = channel;
      });
    }
    rows.push(row);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(iconPng);
const directory = Buffer.alloc(6);
directory.writeUInt16LE(0, 0);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);

let offset = 6 + sizes.length * 16;
const entries = sizes.map((size, index) => {
  const entry = Buffer.alloc(16);
  entry[0] = size === 256 ? 0 : size;
  entry[1] = size === 256 ? 0 : size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(images[index].length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += images[index].length;
  return entry;
});

const output = path.join(__dirname, '..', 'electron', 'icon.ico');
fs.writeFileSync(output, Buffer.concat([directory, ...entries, ...images]));
console.log(`Generated ${output}`);
