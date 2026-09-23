import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = new URL('../public/icons/', import.meta.url);
mkdirSync(output, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function insideEllipse(x, y, cx, cy, rx, ry, rotation = 0) {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const dx = x - cx;
  const dy = y - cy;
  return (dx * cosine + dy * sine) ** 2 / rx ** 2 + (-dx * sine + dy * cosine) ** 2 / ry ** 2 <= 1;
}

function renderIcon(size, maskable) {
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x += 1) {
      const px = (x + 0.5) / size;
      const py = (y + 0.5) / size;
      const dx = px - 0.5;
      const dy = py - 0.5;
      const distance = Math.hypot(dx, dy);
      const outside = maskable ? distance > 0.5 : (Math.abs(dx) > 0.48 || Math.abs(dy) > 0.48 || distance > 0.49);
      let color = [7, 20, 18, 255];
      if (!outside) {
        const inner = maskable ? 0.47 : 0.455;
        const ring = distance < inner && distance > inner - (maskable ? 0.035 : 0.045);
        const wing = insideEllipse(px, py, 0.34, 0.39, 0.22, 0.12, -0.42)
          || insideEllipse(px, py, 0.66, 0.39, 0.22, 0.12, 0.42)
          || insideEllipse(px, py, 0.37, 0.64, 0.17, 0.085, 0.48)
          || insideEllipse(px, py, 0.63, 0.64, 0.17, 0.085, -0.48);
        const body = insideEllipse(px, py, 0.5, 0.51, 0.065, 0.28);
        if (ring) color = [217, 255, 91, 255];
        if (wing) color = [101, 244, 219, 255];
        if (body) color = [217, 255, 91, 255];
        const glow = distance < 0.42;
        if (glow && color[0] === 7) color = [16, 42, 37, 255];
      }
      const offset = 1 + x * 4;
      row[offset] = color[0];
      row[offset + 1] = color[1];
      row[offset + 2] = color[2];
      row[offset + 3] = color[3];
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
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  writeFileSync(new URL(name, output), renderIcon(size, maskable));
}
