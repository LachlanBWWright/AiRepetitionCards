/** Container signatures only; decoding remains the platform audio player's responsibility. */
export function isMp4AudioContainer(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  const ascii = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (ascii(4) !== "ftyp" || size < 16 || size > bytes.length || size > 4096) return false;
  const brands = new Set(["M4A ", "M4B ", "isom", "iso2", "mp41", "mp42", "qt  "]);
  if (brands.has(ascii(8))) return true;
  for (let offset = 16; offset + 4 <= size; offset += 4) if (brands.has(ascii(offset))) return true;
  return false;
}

export function isWebmAudioContainer(bytes: Uint8Array): boolean {
  if (
    bytes.length < 16 ||
    bytes[0] !== 0x1a ||
    bytes[1] !== 0x45 ||
    bytes[2] !== 0xdf ||
    bytes[3] !== 0xa3
  )
    return false;
  const firstSizeByte = bytes[4] ?? 0;
  let width = 1;
  while (width <= 8 && (firstSizeByte & (0x80 >> (width - 1))) === 0) width += 1;
  if (width > 8 || bytes.length < 4 + width) return false;
  let length = firstSizeByte & (0xff >> width);
  for (let offset = 5; offset < 4 + width; offset += 1)
    length = length * 256 + (bytes[offset] ?? 0);
  const end = 4 + width + length;
  if (length > 4096 || end + 4 > bytes.length) return false;
  let webm = false;
  for (let offset = 4 + width; offset + 7 <= end; offset += 1) {
    if (
      bytes[offset] === 0x42 &&
      bytes[offset + 1] === 0x82 &&
      bytes[offset + 2] === 0x84 &&
      String.fromCharCode(...bytes.slice(offset + 3, offset + 7)) === "webm"
    )
      webm = true;
  }
  return (
    webm &&
    bytes[end] === 0x18 &&
    bytes[end + 1] === 0x53 &&
    bytes[end + 2] === 0x80 &&
    bytes[end + 3] === 0x67
  );
}
