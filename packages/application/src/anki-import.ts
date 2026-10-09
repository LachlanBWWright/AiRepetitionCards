import { sha1 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { Effect, Either, Schema } from "effect";
import { unzipSync, type UnzipFileInfo } from "fflate";
import { Decompress } from "fzstd";
import {
  LearningAreaSchema,
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  createReviewEventId,
  MediaReferenceSchema,
  type LearningArea,
  type MediaReference,
} from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";
import { newSchedule, rebuildSchedule } from "@recall/scheduler";
import { hasSafeZipExpansion } from "./zip-safety";

/** The adapter boundary keeps SQLite/WASM/native packages out of the application package. */
export type AnkiNoteType = {
  readonly id: number;
  readonly name: string;
  readonly kind: "basic" | "cloze" | "unsupported";
  readonly fields: readonly string[];
};
export type AnkiNoteRow = {
  readonly id: number;
  readonly guid: string;
  readonly noteTypeId: number;
  /** Anki's notes.flds field, split on U+001F by the platform adapter. */
  readonly fields: readonly string[];
  readonly tags: readonly string[];
};
export type AnkiCardRow = {
  readonly id: number;
  readonly noteId: number;
  /** Zero-based card ordinal. Cloze cards correspond to deletion number ordinal + 1. */
  readonly ordinal: number;
};
export type AnkiReviewRow = {
  readonly cardId: number;
  readonly reviewedAt: number;
  /** Anki ease grade: 1 (again) through 4 (easy). */
  readonly ease: number;
  /** Anki revlog type: learning, review, relearning, cram, or administrative reschedule. */
  readonly type: number;
};
const MAX_FIELD_CHARS = 500_000;
const MAX_NOTES = 500;
const MAX_CARDS = 500;
export type AnkiCollection = {
  readonly deckNames: readonly string[];
  readonly noteTypes: readonly AnkiNoteType[];
  readonly notes: readonly AnkiNoteRow[];
  readonly cards: readonly AnkiCardRow[];
  readonly reviews?: readonly AnkiReviewRow[];
};
export type AnkiSqliteReaderError = {
  readonly _tag: "AnkiSqliteReaderError";
  readonly reason: "unsupported-database" | "invalid-database" | "limits-exceeded";
};
export type AnkiSqliteReader = (
  database: Uint8Array,
) => Effect.Effect<unknown, AnkiSqliteReaderError>;

const AnkiCollectionSchema = Schema.Struct({
  deckNames: Schema.Array(Schema.String.pipe(Schema.maxLength(500))).pipe(
    Schema.maxItems(MAX_CARDS),
  ),
  noteTypes: Schema.Array(
    Schema.Struct({
      id: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
      kind: Schema.Union(
        Schema.Literal("basic"),
        Schema.Literal("cloze"),
        Schema.Literal("unsupported"),
      ),
      fields: Schema.Array(Schema.String.pipe(Schema.maxLength(200))).pipe(Schema.maxItems(100)),
    }),
  ).pipe(Schema.maxItems(500)),
  notes: Schema.Array(
    Schema.Struct({
      id: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      guid: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(300)),
      noteTypeId: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      fields: Schema.Array(Schema.String.pipe(Schema.maxLength(MAX_FIELD_CHARS))).pipe(
        Schema.maxItems(100),
      ),
      tags: Schema.Array(Schema.String.pipe(Schema.maxLength(100))).pipe(Schema.maxItems(100)),
    }),
  ).pipe(Schema.maxItems(MAX_NOTES)),
  cards: Schema.Array(
    Schema.Struct({
      id: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      noteId: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      ordinal: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
    }),
  ).pipe(Schema.maxItems(MAX_CARDS)),
  reviews: Schema.optional(
    Schema.Array(
      Schema.Struct({
        cardId: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
        reviewedAt: Schema.Number.pipe(Schema.finite(), Schema.positive()),
        ease: Schema.Number.pipe(Schema.int(), Schema.between(0, 4)),
        type: Schema.Number.pipe(Schema.int(), Schema.between(0, 4)),
      }),
    ).pipe(Schema.maxItems(10_000)),
  ),
});

export type AnkiImportError = {
  readonly _tag: "AnkiImportError";
  readonly reason:
    | "invalid-input"
    | "limits-exceeded"
    | "unsupported-format"
    | "invalid-archive"
    | "invalid-database"
    | "unsupported-note-type"
    | "invalid-note"
    | "invalid-media"
    | "media-too-large"
    | "invalid-proposal";
};
export type AnkiImportProposal = {
  readonly area: LearningArea;
  readonly media: readonly StoredMediaAsset[];
  readonly reviewEvents: readonly import("@recall/domain").ReviewEvent[];
  readonly excludedReviewCount: number;
  readonly provenance: {
    readonly format: "anki-apkg";
    readonly deckNames: readonly string[];
    readonly noteGuids: readonly string[];
  };
};

/** Database container selected from the ZIP entries in an Anki deck package. */
export type AnkiPackageDatabaseFormat = "legacy-anki2" | "anki21" | "anki21b";

const MAX_ARCHIVE_BYTES = 50_000_000;
const MAX_FILES = 2_000;
const MAX_EXPANDED_BYTES = 100_000_000;
const MAX_DATABASE_BYTES = 80_000_000;
const MAX_MEDIA_BYTES = 20_000_000;
const MAX_MEDIA_ASSETS = 100;
const MAX_PROTO_BYTES = 5_000_000;
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const MISSING = (reason: AnkiImportError["reason"]): AnkiImportError => ({
  _tag: "AnkiImportError",
  reason,
});

function validArchivePath(path: string): boolean {
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
function sha(bytes: Uint8Array): string {
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
function parsePackageVersion(bytes: Uint8Array): number | undefined {
  const fields = protoFields(bytes);
  if (!fields) return undefined;
  const versions = fields.filter(
    (field) => field.number === 1 && field.wire === 0 && typeof field.value === "number",
  );
  if (versions.length !== 1) return undefined;
  const version = versions[0]?.value;
  return typeof version === "number" ? version : undefined;
}
function parseMediaEntries(bytes: Uint8Array):
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
function decompressZstd(bytes: Uint8Array, limit: number): Uint8Array | "invalid" | "limit" {
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
function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function mimeFor(name: string, bytes: Uint8Array): MediaReference["mimeType"] | undefined {
  const lower = name.toLowerCase();
  if (
    lower.endsWith(".png") &&
    bytes.length >= 8 &&
    bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
  )
    return "image/png";
  if (
    (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    lower.endsWith(".gif") &&
    (new TextDecoder().decode(bytes.slice(0, 6)) === "GIF87a" ||
      new TextDecoder().decode(bytes.slice(0, 6)) === "GIF89a")
  )
    return "image/gif";
  if (
    lower.endsWith(".webp") &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  if (
    lower.endsWith(".mp3") &&
    (new TextDecoder().decode(bytes.slice(0, 3)) === "ID3" ||
      (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0))
  )
    return "audio/mpeg";
  if (lower.endsWith(".ogg") && new TextDecoder().decode(bytes.slice(0, 4)) === "OggS")
    return "audio/ogg";
  if (
    lower.endsWith(".wav") &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WAVE"
  )
    return "audio/wav";
  return undefined;
}

type SanitizedField = { readonly text: string; readonly references: readonly MediaReference[] };
function sanitizeField(
  input: string,
  mediaByName: ReadonlyMap<string, StoredMediaAsset>,
): SanitizedField | "invalid-media" | undefined {
  if (input.length > MAX_FIELD_CHARS) return undefined;
  const references = new Map<string, MediaReference>();
  const invalidMedia = { value: false };
  let text = input
    .replace(/<\s*(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|svg|math)\b[^>]*\/?>/gi, "");
  text = text.replace(/\[sound:([^\]\r\n]+)\]/gi, (_match, rawName: string) => {
    const asset = mediaByName.get(rawName.trim());
    if (!asset || !asset.reference.mimeType.startsWith("audio/")) {
      invalidMedia.value = true;
      return "[unsupported audio omitted]";
    }
    references.set(asset.reference.id, asset.reference);
    return `[Audio: ${rawName.replace(/[<>\[\]]/g, "")}]`;
  });
  text = text.replace(/<img\b([^>]*)>/gi, (_match, attrs: string) => {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const rawName = (src?.[1] ?? src?.[2] ?? src?.[3] ?? "").trim();
    const asset = mediaByName.get(rawName);
    if (!asset || !asset.reference.mimeType.startsWith("image/")) {
      invalidMedia.value = true;
      return "[unsupported image omitted]";
    }
    references.set(asset.reference.id, asset.reference);
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const label = (alt?.[1] ?? alt?.[2] ?? rawName).replace(/[<>\[\]]/g, "").slice(0, 200);
    return `[Image: ${label}]`;
  });
  // Retain a small formatting subset without any attributes. All links are reduced to their
  // visible text so javascript:, remote tracking URLs, and unsafe embedded content disappear.
  text = text
    .replace(/<\s*(br|hr)\b[^>]*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(div|p|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*(div|p|li|h[1-6])\b[^>]*>/gi, "")
    .replace(/<\s*(b|strong|i|em|u|s|del|code|pre|sub|sup|ul|ol|blockquote)\b[^>]*>/gi, "<$1>")
    .replace(/<\s*\/\s*(b|strong|i|em|u|s|del|code|pre|sub|sup|ul|ol|blockquote)\s*>/gi, "</$1>")
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi, "$1")
    .replace(/<\s*[^>]*>/g, "")
    // Keep other entities encoded: decoding &lt;script&gt; here could recreate active markup
    // after tags had already been filtered.
    .replace(/&nbsp;/gi, " ")
    .trim();
  if (invalidMedia.value) return "invalid-media";
  return text ? { text, references: [...references.values()] } : undefined;
}

const defaultId = (): string => globalThis.crypto.randomUUID();

/**
 * Stage 1 validates and bounds the archive; stage 2 delegates SQLite decoding to a platform
 * adapter; stage 3 validates, sanitizes and proposes canonical content. The mapping follows
 * Anki's documented distinction between notes, note types, generated cards, and package media.
 * No SQLite implementation is bundled here. `.anki21` is an uncompressed SQLite database.
 * Latest packages declare version 3 in the protobuf `meta` entry, zstd-compress the collection,
 * media manifest, and media files, and encode the manifest as `MediaEntries` protobuf.
 */
export function importAnkiApkg(
  input: unknown,
  options: {
    readonly title?: string;
    readonly color: string;
    readonly createId?: () => string;
    readonly now: Date;
  },
  readSqlite: AnkiSqliteReader,
): Effect.Effect<AnkiImportProposal, AnkiImportError> {
  return Effect.gen(function* () {
    if (!Number.isFinite(options.now.getTime()))
      return yield* Effect.fail(MISSING("invalid-input"));
    if (!(input instanceof Uint8Array)) return yield* Effect.fail(MISSING("invalid-input"));
    if (input.byteLength > MAX_ARCHIVE_BYTES) return yield* Effect.fail(MISSING("limits-exceeded"));
    if (input.length < 4 || ZIP_SIGNATURE.some((byte, index) => input[index] !== byte)) {
      return yield* Effect.fail(MISSING("unsupported-format"));
    }
    // Inspect central-directory sizes before unzipSync inflates any entry. The bounded import
    // totals below are still checked during extraction because directory metadata is untrusted.
    const zipEntries = yield* Effect.try({
      try: () => {
        const entries: UnzipFileInfo[] = [];
        unzipSync(input, {
          filter: (entry) => {
            if (entries.length <= MAX_FILES) entries.push(entry);
            return false;
          },
        });
        return entries;
      },
      catch: () => MISSING("invalid-archive"),
    });
    if (
      !hasSafeZipExpansion(zipEntries, {
        maxFiles: MAX_FILES,
        maxExpandedBytes: MAX_EXPANDED_BYTES,
      })
    )
      return yield* Effect.fail(MISSING("limits-exceeded"));
    let fileCount = 0;
    let expandedBytes = 0;
    const archiveState = { duplicatePath: false };
    const seenPaths = new Set<string>();
    const archive = yield* Effect.try({
      try: () =>
        unzipSync(input, {
          filter: (entry) => {
            fileCount += 1;
            expandedBytes += entry.originalSize;
            if (seenPaths.has(entry.name)) archiveState.duplicatePath = true;
            seenPaths.add(entry.name);
            return (
              fileCount <= MAX_FILES &&
              expandedBytes <= MAX_EXPANDED_BYTES &&
              validArchivePath(entry.name)
            );
          },
        }),
      catch: () => MISSING("invalid-archive"),
    });
    if (fileCount > MAX_FILES || expandedBytes > MAX_EXPANDED_BYTES)
      return yield* Effect.fail(MISSING("limits-exceeded"));
    const names = Object.keys(archive);
    if (
      archiveState.duplicatePath ||
      names.length !== fileCount ||
      names.some((name) => !validArchivePath(name))
    )
      return yield* Effect.fail(MISSING("invalid-archive"));
    const metadataBytes = archive.meta;
    const packageVersion = metadataBytes ? parsePackageVersion(metadataBytes) : undefined;
    if (metadataBytes && (packageVersion === undefined || packageVersion < 1 || packageVersion > 3))
      return yield* Effect.fail(MISSING("unsupported-format"));
    // Anki selects by package metadata, not by the presence of compatibility placeholders.
    // Older packages without metadata use the historical collection.anki21/anki2 detection.
    const selectedDatabaseEntry =
      packageVersion === 3
        ? archive["collection.anki21b"]
          ? (["collection.anki21b", "anki21b"] as const)
          : undefined
        : packageVersion === 2
          ? archive["collection.anki21"]
            ? (["collection.anki21", "anki21"] as const)
            : undefined
          : packageVersion === 1
            ? archive["collection.anki2"]
              ? (["collection.anki2", "legacy-anki2"] as const)
              : undefined
            : archive["collection.anki21"]
              ? (["collection.anki21", "anki21"] as const)
              : archive["collection.anki2"]
                ? (["collection.anki2", "legacy-anki2"] as const)
                : undefined;
    if (!selectedDatabaseEntry) return yield* Effect.fail(MISSING("unsupported-format"));
    const [databaseName, databaseFormat] = selectedDatabaseEntry;
    const databasePayload = archive[databaseName];
    const mediaIndexBytes = archive.media;
    if (!databasePayload || !mediaIndexBytes)
      return yield* Effect.fail(MISSING("unsupported-format"));
    if (databasePayload.byteLength > MAX_DATABASE_BYTES)
      return yield* Effect.fail(MISSING("limits-exceeded"));
    let database: Uint8Array = databasePayload;
    let mediaIndexRecord: Record<string, unknown> | undefined;
    let modernMedia: ReturnType<typeof parseMediaEntries> = [];
    if (databaseFormat === "anki21b") {
      const expandedDatabase = decompressZstd(databasePayload, MAX_DATABASE_BYTES);
      if (expandedDatabase === "limit") return yield* Effect.fail(MISSING("limits-exceeded"));
      if (expandedDatabase === "invalid") return yield* Effect.fail(MISSING("invalid-database"));
      database = expandedDatabase;
      const expandedManifest = decompressZstd(mediaIndexBytes, MAX_PROTO_BYTES);
      if (expandedManifest === "limit") return yield* Effect.fail(MISSING("limits-exceeded"));
      if (expandedManifest === "invalid") return yield* Effect.fail(MISSING("invalid-archive"));
      const decodedManifest = parseMediaEntries(expandedManifest);
      if (!decodedManifest) return yield* Effect.fail(MISSING("invalid-archive"));
      modernMedia = decodedManifest;
    } else {
      const mediaIndex = yield* Effect.try({
        try: () => parseJson(mediaIndexBytes),
        catch: () => MISSING("invalid-archive"),
      });
      mediaIndexRecord = asRecord(mediaIndex);
      if (
        !mediaIndexRecord ||
        Object.keys(mediaIndexRecord).some(
          (key) => !/^\d+$/.test(key) || typeof mediaIndexRecord?.[key] !== "string",
        )
      )
        return yield* Effect.fail(MISSING("invalid-archive"));
      const mediaNames = Object.values(mediaIndexRecord) as string[];
      if (
        new Set(mediaNames).size !== mediaNames.length ||
        mediaNames.some(
          (name) =>
            name.length === 0 ||
            name.includes("/") ||
            name.includes("\\") ||
            name === "." ||
            name === "..",
        )
      )
        return yield* Effect.fail(MISSING("invalid-archive"));
      if (mediaNames.length > MAX_MEDIA_ASSETS)
        return yield* Effect.fail(MISSING("limits-exceeded"));
    }
    const mediaByName = new Map<string, StoredMediaAsset>();
    if (databaseFormat === "anki21b") {
      if (
        new Set(modernMedia.map((entry) => entry.name)).size !== modernMedia.length ||
        modernMedia.some(
          (entry) =>
            !entry.name ||
            entry.name.includes("/") ||
            entry.name.includes("\\") ||
            entry.name === "." ||
            entry.name === "..",
        ) ||
        new Set(modernMedia.map((entry) => entry.zipName)).size !== modernMedia.length
      )
        return yield* Effect.fail(MISSING("invalid-archive"));
      const mediaZipNames = new Set(modernMedia.map((entry) => String(entry.zipName)));
      if (names.some((name) => /^\d+$/.test(name) && !mediaZipNames.has(name)))
        return yield* Effect.fail(MISSING("invalid-archive"));
      let totalDecodedMediaBytes = 0;
      for (const entry of modernMedia) {
        if (entry.size > MAX_MEDIA_BYTES) return yield* Effect.fail(MISSING("media-too-large"));
        const payload = archive[String(entry.zipName)];
        if (!payload) return yield* Effect.fail(MISSING("invalid-media"));
        const expanded = decompressZstd(payload, MAX_MEDIA_BYTES);
        if (expanded === "limit") return yield* Effect.fail(MISSING("media-too-large"));
        if (expanded === "invalid") return yield* Effect.fail(MISSING("invalid-media"));
        totalDecodedMediaBytes += expanded.byteLength;
        if (totalDecodedMediaBytes > MAX_EXPANDED_BYTES)
          return yield* Effect.fail(MISSING("limits-exceeded"));
        if (
          expanded.byteLength !== entry.size ||
          sha1(expanded).some((byte, index) => byte !== entry.sha1[index])
        )
          return yield* Effect.fail(MISSING("invalid-media"));
        const mimeType = mimeFor(entry.name, expanded);
        if (!mimeType) return yield* Effect.fail(MISSING("invalid-media"));
        const decodedReference = Schema.decodeUnknownEither(MediaReferenceSchema)({
          id: sha(expanded),
          mimeType,
          byteLength: expanded.byteLength,
        });
        if (Either.isLeft(decodedReference)) return yield* Effect.fail(MISSING("invalid-media"));
        mediaByName.set(entry.name, { reference: decodedReference.right, bytes: expanded });
      }
    } else {
      for (const [index, fileName] of Object.entries(mediaIndexRecord ?? {})) {
        const bytes = archive[index];
        if (!bytes) return yield* Effect.fail(MISSING("invalid-media"));
        if (bytes.byteLength > MAX_MEDIA_BYTES)
          return yield* Effect.fail(MISSING("media-too-large"));
        const mimeType = mimeFor(fileName as string, bytes);
        if (!mimeType) return yield* Effect.fail(MISSING("invalid-media"));
        const referenceValue = { id: sha(bytes), mimeType, byteLength: bytes.byteLength };
        const decodedReference = Schema.decodeUnknownEither(MediaReferenceSchema)(referenceValue);
        if (Either.isLeft(decodedReference)) return yield* Effect.fail(MISSING("invalid-media"));
        mediaByName.set(fileName as string, { reference: decodedReference.right, bytes });
      }
      if (names.some((name) => /^\d+$/.test(name) && !Object.hasOwn(mediaIndexRecord ?? {}, name)))
        return yield* Effect.fail(MISSING("invalid-archive"));
    }

    const rawCollection = yield* readSqlite(database).pipe(
      Effect.mapError((error) =>
        MISSING(
          error.reason === "unsupported-database"
            ? "unsupported-format"
            : error.reason === "limits-exceeded"
              ? "limits-exceeded"
              : "invalid-database",
        ),
      ),
    );
    const decodedCollection = Schema.decodeUnknownEither(AnkiCollectionSchema)(rawCollection);
    if (Either.isLeft(decodedCollection)) return yield* Effect.fail(MISSING("invalid-database"));
    const collection = decodedCollection.right;
    const noteTypes = new Map(collection.noteTypes.map((noteType) => [noteType.id, noteType]));
    const notes = new Map(collection.notes.map((note) => [note.id, note]));
    if (
      notes.size !== collection.notes.length ||
      noteTypes.size !== collection.noteTypes.length ||
      new Set(collection.cards.map((card) => card.id)).size !== collection.cards.length
    )
      return yield* Effect.fail(MISSING("invalid-database"));
    const objectiveId = createObjectiveId((options.createId ?? defaultId)());
    const cards: LearningArea["cards"][number][] = [];
    const cardIdsByAnkiId = new Map<number, LearningArea["cards"][number]["id"]>();
    const usedRefs = new Map<string, MediaReference>();
    const noteGuids: string[] = [];
    const sortedCards = [...collection.cards].sort((left, right) => left.id - right.id);
    for (const card of sortedCards) {
      const note = notes.get(card.noteId);
      const noteType = note ? noteTypes.get(note.noteTypeId) : undefined;
      if (!note || !noteType) return yield* Effect.fail(MISSING("invalid-database"));
      if (noteType.kind === "unsupported")
        return yield* Effect.fail(MISSING("unsupported-note-type"));
      const fieldsByName = new Map(
        noteType.fields.map((name, index) => [name.toLowerCase(), note.fields[index] ?? ""]),
      );
      if (noteType.kind === "basic") {
        if (card.ordinal > 1) return yield* Effect.fail(MISSING("unsupported-note-type"));
        const frontRaw = fieldsByName.get("front");
        const backRaw = fieldsByName.get("back");
        if (frontRaw === undefined || backRaw === undefined)
          return yield* Effect.fail(MISSING("unsupported-note-type"));
        const first = sanitizeField(card.ordinal === 0 ? frontRaw : backRaw, mediaByName);
        const second = sanitizeField(card.ordinal === 0 ? backRaw : frontRaw, mediaByName);
        if (first === "invalid-media" || second === "invalid-media")
          return yield* Effect.fail(MISSING("invalid-media"));
        if (!first || !second) return yield* Effect.fail(MISSING("invalid-note"));
        for (const ref of [...first.references, ...second.references]) usedRefs.set(ref.id, ref);
        const importedCardId = createAssessmentId((options.createId ?? defaultId)());
        cardIdsByAnkiId.set(card.id, importedCardId);
        cards.push({
          id: importedCardId,
          sourceId: `anki:${note.guid}:${String(card.ordinal)}`,
          front: first.text,
          back: second.text,
          objective: "Imported from Anki",
          objectiveIds: [objectiveId],
          tags: note.tags,
          origin: "imported",
          schedule: newSchedule(options.now),
          media: [
            ...new Map(
              [...first.references, ...second.references].map((ref) => [ref.id, ref]),
            ).values(),
          ],
        });
      } else {
        const textRaw = fieldsByName.get("text");
        if (textRaw === undefined) return yield* Effect.fail(MISSING("unsupported-note-type"));
        if (card.ordinal > 19) return yield* Effect.fail(MISSING("unsupported-note-type"));
        const match = /\{\{c(\d+)::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g;
        const clozeNumbers = [...textRaw.matchAll(match)].map((entry) => Number(entry[1]));
        if (!clozeNumbers.includes(card.ordinal + 1))
          return yield* Effect.fail(MISSING("invalid-note"));
        const frontHtml = textRaw.replace(match, (full, number: string, answer: string) =>
          Number(number) === card.ordinal + 1 ? "[…]" : answer,
        );
        const backHtml = textRaw.replace(match, (_full, _number: string, answer: string) => answer);
        const front = sanitizeField(frontHtml, mediaByName);
        const back = sanitizeField(backHtml, mediaByName);
        if (front === "invalid-media" || back === "invalid-media")
          return yield* Effect.fail(MISSING("invalid-media"));
        if (!front || !back) return yield* Effect.fail(MISSING("invalid-note"));
        for (const ref of [...front.references, ...back.references]) usedRefs.set(ref.id, ref);
        const importedCardId = createAssessmentId((options.createId ?? defaultId)());
        cardIdsByAnkiId.set(card.id, importedCardId);
        cards.push({
          id: importedCardId,
          sourceId: `anki:${note.guid}:${String(card.ordinal)}`,
          front: front.text,
          back: back.text,
          objective: "Imported from Anki",
          objectiveIds: [objectiveId],
          tags: note.tags,
          origin: "imported",
          schedule: newSchedule(options.now),
          media: [
            ...new Map(
              [...front.references, ...back.references].map((ref) => [ref.id, ref]),
            ).values(),
          ],
        });
      }
      if (!noteGuids.includes(note.guid)) noteGuids.push(note.guid);
    }
    if (cards.length === 0) return yield* Effect.fail(MISSING("invalid-note"));
    const areaId = createAreaId((options.createId ?? defaultId)());
    const reviewEvents: import("@recall/domain").ReviewEvent[] = [];
    let excludedReviewCount = 0;
    const previousReviewByCard = new Map<string, import("@recall/domain").ReviewEvent["id"]>();
    for (const review of [...(collection.reviews ?? [])].sort(
      (left, right) => left.reviewedAt - right.reviewedAt,
    )) {
      // Cram reviews do not affect Anki's schedule, and type 4 rows are administrative
      // reschedules rather than answers. Do not invent FSRS review events for either.
      if (review.type === 3 || review.type === 4) {
        excludedReviewCount += 1;
        continue;
      }
      const cardId = cardIdsByAnkiId.get(review.cardId);
      if (
        !cardId ||
        review.ease < 1 ||
        review.ease > 4 ||
        !Number.isSafeInteger(review.reviewedAt) ||
        review.reviewedAt <= 0 ||
        review.reviewedAt > 8_640_000_000_000_000
      )
        return yield* Effect.fail(MISSING("invalid-database"));
      const reviewedAt = new Date(review.reviewedAt).toISOString();
      const eventId = createReviewEventId((options.createId ?? defaultId)());
      const event: import("@recall/domain").ReviewEvent = {
        id: eventId,
        areaId,
        cardId,
        ratedAt: reviewedAt,
        rating: (["again", "again", "hard", "good", "easy"] as const)[review.ease] ?? "again",
        schedulerFamily: "fsrs",
        schedulerVersion: "anki-import-v1",
        baseReviewEventId: previousReviewByCard.get(cardId) ?? null,
        effectiveReviewedAt: reviewedAt,
      };
      reviewEvents.push(event);
      previousReviewByCard.set(cardId, eventId);
    }
    const reviewsByCard = new Map<string, import("@recall/domain").ReviewEvent[]>();
    for (const event of reviewEvents) {
      const cardReviews = reviewsByCard.get(event.cardId) ?? [];
      cardReviews.push(event);
      reviewsByCard.set(event.cardId, cardReviews);
    }
    const scheduledCards = yield* Effect.forEach(cards, (card) => {
      const cardReviews = reviewsByCard.get(card.id);
      return cardReviews
        ? rebuildSchedule(cardReviews).pipe(
            Effect.map((schedule) => ({ ...card, schedule })),
            Effect.mapError(() => MISSING("invalid-proposal")),
          )
        : Effect.succeed(card);
    });
    const areaValue = {
      id: areaId,
      title: (options.title?.trim() || collection.deckNames[0] || "Imported Anki deck").slice(
        0,
        80,
      ),
      color: options.color,
      sourceId: "anki-apkg",
      description: `Imported from Anki: ${collection.deckNames.join(", ") || "deck"}`.slice(
        0,
        2_000,
      ),
      language: "en",
      objectives: [
        { id: objectiveId, title: "Imported from Anki", description: null, prerequisiteIds: [] },
      ],
      cards: scheduledCards,
      tags: [],
      licence: null,
    };
    const decodedArea = Schema.decodeUnknownEither(LearningAreaSchema)(areaValue);
    if (Either.isLeft(decodedArea)) return yield* Effect.fail(MISSING("invalid-proposal"));
    return {
      area: decodedArea.right,
      media: [...usedRefs.keys()].flatMap((id) => {
        const asset = [...mediaByName.values()].find((candidate) => candidate.reference.id === id);
        return asset ? [asset] : [];
      }),
      reviewEvents,
      excludedReviewCount,
      provenance: { format: "anki-apkg", deckNames: collection.deckNames, noteGuids },
    };
  });
}
