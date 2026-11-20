export type EditableMedia =
  | { readonly kind: "image"; readonly width: number; readonly height: number }
  | {
      readonly kind: "audio";
      readonly duration: number;
      readonly sampleRate: number;
      readonly channels: number;
    };
const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));
function dimensions(bytes: Uint8Array, mime: string): readonly [number, number] | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    mime === "image/png" &&
    bytes.length >= 33 &&
    bytes[0] === 137 &&
    ascii(bytes, 1, 3) === "PNG" &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10 &&
    ascii(bytes, 12, 4) === "IHDR"
  ) {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (offset + 12 + length > bytes.length || ascii(bytes, offset + 4, 4) === "acTL")
        return undefined;
      offset += 12 + length;
    }
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (mime === "image/gif" && bytes.length >= 10 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6)))
    return [view.getUint16(6, true), view.getUint16(8, true)];
  if (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) return undefined;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218 || marker === undefined) return undefined;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) return undefined;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return undefined;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker))
        return length >= 8 ? [view.getUint16(offset + 5), view.getUint16(offset + 3)] : undefined;
      offset += length;
    }
  }
  if (
    mime === "image/webp" &&
    bytes.length >= 30 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    const kind = ascii(bytes, 12, 4);
    if (kind === "VP8X") {
      // Extended containers can declare a small canvas around a larger coded frame.
      // Keep these on the original path until both dimensions can be proven consistent.
      return undefined;
    }
    if (kind === "VP8 " && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42)
      return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff];
    if (kind === "VP8L" && bytes[20] === 47) {
      const packed = view.getUint32(21, true);
      return [1 + (packed & 0x3fff), 1 + ((packed >>> 14) & 0x3fff)];
    }
  }
  return undefined;
}
function wave(bytes: Uint8Array): EditableMedia | undefined {
  if (bytes.length < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE")
    return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) return undefined;
  let format:
    { readonly channels: number; readonly rate: number; readonly align: number } | undefined;
  let dataLength: number | undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > bytes.length) return undefined;
    const tag = ascii(bytes, offset, 4);
    if (tag === "fmt ") {
      if (format || size !== 16 || view.getUint16(start, true) !== 1) return undefined;
      const channels = view.getUint16(start + 2, true);
      const rate = view.getUint32(start + 4, true);
      const bits = view.getUint16(start + 14, true);
      const align = view.getUint16(start + 12, true);
      if (
        channels < 1 ||
        channels > 2 ||
        rate < 8000 ||
        rate > 96000 ||
        ![8, 16, 24, 32].includes(bits) ||
        align !== (channels * bits) / 8 ||
        view.getUint32(start + 8, true) !== rate * align
      )
        return undefined;
      format = { channels, rate, align };
    } else if (tag === "data") {
      if (dataLength !== undefined) return undefined;
      dataLength = size;
    }
    offset = start + size + (size % 2);
  }
  if (!format || !dataLength || dataLength % format.align !== 0) return undefined;
  const duration = dataLength / format.align / format.rate;
  return duration > 0 && duration <= 300
    ? { kind: "audio", duration, sampleRate: format.rate, channels: format.channels }
    : undefined;
}
/** Inspect bounded bytes before browser codecs or media elements see the source. */
export function inspectEditableMedia(bytes: Uint8Array, mime: string): EditableMedia | undefined {
  if (bytes.length < 1 || bytes.length > 20_000_000) return undefined;
  if (mime === "audio/wav") return wave(bytes);
  // GIF previews can allocate unbounded frame sequences. A still PNG/JPEG/WebP is editable.
  if (mime === "image/gif") return undefined;
  const size = dimensions(bytes, mime);
  if (!size) return undefined;
  const [width, height] = size;
  return width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16_000_000
    ? { kind: "image", width, height }
    : undefined;
}
