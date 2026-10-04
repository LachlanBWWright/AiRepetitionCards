import { deflateSync } from "node:zlib";

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const payload = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, payload, checksum]);
}
/** Source-owned square monogram with safe padding for masked app icons. */
export function offlineIcon(size) {
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x / size;
      const dy = y / size;
      const letter =
        (dx >= 0.34 && dx < 0.44 && dy >= 0.34 && dy < 0.74) ||
        (dx >= 0.44 && dx < 0.64 && dy >= 0.34 && dy < 0.44) ||
        (dx >= 0.58 && dx < 0.68 && dy >= 0.34 && dy < 0.55);
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      pixels.set(letter ? [250, 249, 246, 255] : [41, 50, 43, 255], offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
