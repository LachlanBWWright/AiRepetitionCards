import { sha256 } from "@noble/hashes/sha2.js";
import { Decompress } from "fzstd";

export const MAX_ARCHIVE_BYTES = 50_000_000;
export const MAX_FILES = 2_000;
export const MAX_EXPANDED_BYTES = 100_000_000;
export const MAX_DATABASE_BYTES = 80_000_000;
export const MAX_MEDIA_BYTES = 20_000_000;
export const MAX_MEDIA_ASSETS = 100;
export const MAX_PROTO_BYTES = 5_000_000;
export const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

export function validArchivePath(path: string): boolean {
  // Only the conventional database and decimal media entries are consumed. Reject aliases,
  // traversal, alternate separators, drive prefixes, and normalization tricks outright.
  return (
    path === "collection.anki2" ||
    path === "collection.anki21" ||
    path === "collection.anki21b" ||
    path === "meta" ||
    path === "media" ||
    /^\d+$/.test(path)
  );
}
export function sha(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function readVarint(
  bytes: Uint8Array,
  start: number,
): { readonly value: number; readonly next: number } | undefined {
  let value = 0;
  let shift = 0;
  for (let offset = start; offset < bytes.length && offset < start + 10; offset += 1) {
    const byte = bytes[offset] ?? 0;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: offset + 1 };
    shift += 7;
  }
  return undefined;
}
type ProtoField = {
  readonly number: number;
  readonly wire: number;
  readonly value: number | Uint8Array;
};
function protoFields(bytes: Uint8Array): readonly ProtoField[] | undefined {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset);
    if (!key) return undefined;
    offset = key.next;
    const number = Math.floor(key.value / 8);
    const wire = key.value & 7;
    if (number < 1 || !Number.isSafeInteger(key.value)) return undefined;
    if (wire === 0) {
      const value = readVarint(bytes, offset);
      if (!value || !Number.isSafeInteger(value.value)) return undefined;
      offset = value.next;
      fields.push({ number, wire, value: value.value });
    } else if (wire === 2) {
      const size = readVarint(bytes, offset);
      if (!size || !Number.isSafeInteger(size.value)) return undefined;
      offset = size.next;
      if (size.value > bytes.length - offset) return undefined;
      fields.push({ number, wire, value: bytes.subarray(offset, offset + size.value) });
      offset += size.value;
    } else if (wire === 1 || wire === 5) {
      const size = wire === 1 ? 8 : 4;
      if (size > bytes.length - offset) return undefined;
      offset += size;
    } else {
      return undefined;
    }
  }
  return fields;
}
export function parsePackageVersion(bytes: Uint8Array): number | undefined {
  const fields = protoFields(bytes);
  if (!fields) return undefined;
  const versions = fields.filter(
    (field) => field.number === 1 && field.wire === 0 && typeof field.value === "number",
  );
  if (versions.length !== 1) return undefined;
  const version = versions[0]?.value;
  return typeof version === "number" ? version : undefined;
}
export function parseMediaEntries(bytes: Uint8Array):
  | readonly {
      readonly name: string;
      readonly size: number;
      readonly sha1: Uint8Array;
      readonly zipName: number;
    }[]
  | undefined {
  if (bytes.byteLength > MAX_PROTO_BYTES) return undefined;
  const result: { name: string; size: number; sha1: Uint8Array; zipName: number }[] = [];
  const fields = protoFields(bytes);
  if (!fields) return undefined;
  for (const field of fields) {
    if (field.number !== 1 || field.wire !== 2 || !(field.value instanceof Uint8Array)) continue;
    let name: string | undefined;
    let size: number | undefined;
    let digest: Uint8Array | undefined;
    let zipName: number | undefined;
    const entryFields = protoFields(field.value);
    if (!entryFields) return undefined;
    for (const entryField of entryFields) {
      if (
        entryField.number === 1 &&
        entryField.wire === 2 &&
        entryField.value instanceof Uint8Array
      )
        name = new TextDecoder().decode(entryField.value);
      else if (
        entryField.number === 2 &&
        entryField.wire === 0 &&
        typeof entryField.value === "number"
      )
        size = entryField.value;
      else if (
        entryField.number === 3 &&
        entryField.wire === 2 &&
        entryField.value instanceof Uint8Array
      )
        digest = entryField.value;
      else if (
        entryField.number === 255 &&
        entryField.wire === 0 &&
        typeof entryField.value === "number"
      )
        zipName = entryField.value;
    }
    if (name === undefined || size === undefined || !digest || digest.byteLength !== 20)
      return undefined;
    result.push({ name, size, sha1: digest, zipName: zipName ?? result.length });
    if (result.length > MAX_MEDIA_ASSETS) return undefined;
  }
  return result;
}
function zstdWindowSize(bytes: Uint8Array): number | undefined {
  if (
    bytes.length < 6 ||
    bytes[0] !== 0x28 ||
    bytes[1] !== 0xb5 ||
    bytes[2] !== 0x2f ||
    bytes[3] !== 0xfd
  )
    return undefined;
  const descriptor = bytes[4] ?? 0;
  if (descriptor & 0x08) return undefined;
  const singleSegment = (descriptor & 0x20) !== 0;
  if (singleSegment) {
    const sizeFlag = descriptor >>> 6;
    const sizeBytes = sizeFlag === 0 ? 1 : 1 << sizeFlag;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const cursor = 5 + dictionaryBytes;
    if (cursor + sizeBytes > bytes.length) return undefined;
    let frameSize = 0;
    for (let index = 0; index < sizeBytes; index += 1)
      frameSize += (bytes[cursor + index] ?? 0) * 2 ** (8 * index);
    if (sizeFlag === 1) frameSize += 256;
    return frameSize;
  }
  return 2 ** (10 + ((bytes[5] ?? 0) >>> 3)) * (1 + ((bytes[5] ?? 0) & 7) / 8);
}
export function decompressZstd(bytes: Uint8Array, limit: number): Uint8Array | "invalid" | "limit" {
  const windowSize = zstdWindowSize(bytes);
  if (windowSize === undefined) return "invalid";
  if (windowSize > limit) return "limit";
  const chunks: Uint8Array[] = [];
  let size = 0;
  const outputOverflow = { value: false };
  try {
    const decoder = new Decompress((chunk) => {
      size += chunk.byteLength;
      if (size > limit) outputOverflow.value = true;
      else chunks.push(chunk);
    });
    for (let offset = 0; offset < bytes.length; offset += 16_384) {
      decoder.push(
        bytes.subarray(offset, Math.min(offset + 16_384, bytes.length)),
        offset + 16_384 >= bytes.length,
      );
    }
  } catch {
    return "invalid";
  }
  if (outputOverflow.value) return "limit";
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
export function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
