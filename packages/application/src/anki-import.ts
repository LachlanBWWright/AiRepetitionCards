import { sha256 } from "@noble/hashes/sha2.js";
import { Effect, Either, Schema } from "effect";
import { unzipSync } from "fflate";
import {
  LearningAreaSchema,
  MediaReferenceSchema,
  type LearningArea,
  type MediaReference,
} from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";
import { newSchedule } from "@recall/scheduler";

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
const MAX_FIELD_CHARS = 500_000;
const MAX_NOTES = 500;
const MAX_CARDS = 500;
export type AnkiCollection = {
  readonly deckNames: readonly string[];
  readonly noteTypes: readonly AnkiNoteType[];
  readonly notes: readonly AnkiNoteRow[];
  readonly cards: readonly AnkiCardRow[];
};
export type AnkiSqliteReaderError = {
  readonly _tag: "AnkiSqliteReaderError";
  readonly reason: "unsupported-database" | "invalid-database";
};
export type AnkiSqliteReader = (
  database: Uint8Array,
) => Effect.Effect<unknown, AnkiSqliteReaderError>;

const AnkiCollectionSchema = Schema.Struct({
  deckNames: Schema.Array(Schema.String.pipe(Schema.maxLength(500))).pipe(Schema.maxItems(200)),
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
  readonly provenance: {
    readonly format: "anki-apkg";
    readonly deckNames: readonly string[];
    readonly noteGuids: readonly string[];
  };
};

const MAX_ARCHIVE_BYTES = 50_000_000;
const MAX_FILES = 2_000;
const MAX_EXPANDED_BYTES = 100_000_000;
const MAX_DATABASE_BYTES = 80_000_000;
const MAX_MEDIA_BYTES = 20_000_000;
const MAX_MEDIA_ASSETS = 100;
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
    path === "media" ||
    /^\d+$/.test(path)
  );
}
function sha(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
  let invalidMedia = false;
  let text = input
    .replace(/<\s*(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|svg|math)\b[^>]*\/?>/gi, "");
  text = text.replace(/\[sound:([^\]\r\n]+)\]/gi, (_match, rawName: string) => {
    const asset = mediaByName.get(rawName.trim());
    if (!asset || !asset.reference.mimeType.startsWith("audio/")) {
      invalidMedia = true;
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
      invalidMedia = true;
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
  if (invalidMedia) return "invalid-media";
  return text ? { text, references: [...references.values()] } : undefined;
}

const defaultId = (): string => globalThis.crypto.randomUUID();

/**
 * Stage 1 validates and bounds the archive; stage 2 delegates SQLite decoding to a platform
 * adapter; stage 3 validates, sanitizes and proposes canonical content. The mapping follows
 * Anki's documented distinction between notes, note types, generated cards, and package media.
 * No SQLite implementation is bundled here. `.anki21`/`.anki21b` and collection packages are unsupported.
 */
export function importAnkiApkg(
  input: unknown,
  options: { readonly title?: string; readonly color: string; readonly createId?: () => string },
  readSqlite: AnkiSqliteReader,
): Effect.Effect<AnkiImportProposal, AnkiImportError> {
  return Effect.gen(function* () {
    if (!(input instanceof Uint8Array)) return yield* Effect.fail(MISSING("invalid-input"));
    if (input.byteLength > MAX_ARCHIVE_BYTES) return yield* Effect.fail(MISSING("limits-exceeded"));
    if (input.length < 4 || ZIP_SIGNATURE.some((byte, index) => input[index] !== byte)) {
      return yield* Effect.fail(MISSING("unsupported-format"));
    }
    let fileCount = 0;
    let expandedBytes = 0;
    const archive = yield* Effect.try({
      try: () =>
        unzipSync(input, {
          filter: (entry) => {
            fileCount += 1;
            expandedBytes += entry.originalSize;
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
    if (names.length !== fileCount || names.some((name) => !validArchivePath(name)))
      return yield* Effect.fail(MISSING("invalid-archive"));
    if (archive["collection.anki21"] || archive["collection.anki21b"])
      return yield* Effect.fail(MISSING("unsupported-format"));
    const database = archive["collection.anki2"];
    const mediaIndexBytes = archive.media;
    if (!database || !mediaIndexBytes) return yield* Effect.fail(MISSING("unsupported-format"));
    if (database.byteLength > MAX_DATABASE_BYTES)
      return yield* Effect.fail(MISSING("limits-exceeded"));
    const mediaIndex = yield* Effect.try({
      try: () => parseJson(mediaIndexBytes),
      catch: () => MISSING("invalid-archive"),
    });
    const mediaIndexRecord = asRecord(mediaIndex);
    if (
      !mediaIndexRecord ||
      Object.keys(mediaIndexRecord).some(
        (key) => !/^\d+$/.test(key) || typeof mediaIndexRecord[key] !== "string",
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
    if (mediaNames.length > MAX_MEDIA_ASSETS) return yield* Effect.fail(MISSING("limits-exceeded"));
    const mediaByName = new Map<string, StoredMediaAsset>();
    for (const [index, fileName] of Object.entries(mediaIndexRecord)) {
      const bytes = archive[index];
      if (!bytes) return yield* Effect.fail(MISSING("invalid-media"));
      if (bytes.byteLength > MAX_MEDIA_BYTES) return yield* Effect.fail(MISSING("media-too-large"));
      const mimeType = mimeFor(fileName as string, bytes);
      if (!mimeType) return yield* Effect.fail(MISSING("invalid-media"));
      const referenceValue = { id: sha(bytes), mimeType, byteLength: bytes.byteLength };
      const decodedReference = Schema.decodeUnknownEither(MediaReferenceSchema)(referenceValue);
      if (Either.isLeft(decodedReference)) return yield* Effect.fail(MISSING("invalid-media"));
      mediaByName.set(fileName as string, { reference: decodedReference.right, bytes });
    }
    if (names.some((name) => /^\d+$/.test(name) && !Object.hasOwn(mediaIndexRecord, name)))
      return yield* Effect.fail(MISSING("invalid-archive"));

    const rawCollection = yield* readSqlite(database).pipe(
      Effect.mapError((error) =>
        MISSING(
          error.reason === "unsupported-database" ? "unsupported-format" : "invalid-database",
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
    const objectiveId = (options.createId ?? defaultId)();
    const cards: LearningArea["cards"][number][] = [];
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
        cards.push({
          id: (options.createId ?? defaultId)(),
          sourceId: `anki:${note.guid}:${card.ordinal}`,
          front: first.text,
          back: second.text,
          objective: "Imported from Anki",
          objectiveIds: [objectiveId],
          tags: note.tags,
          origin: "imported",
          schedule: newSchedule(),
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
        cards.push({
          id: (options.createId ?? defaultId)(),
          sourceId: `anki:${note.guid}:${card.ordinal}`,
          front: front.text,
          back: back.text,
          objective: "Imported from Anki",
          objectiveIds: [objectiveId],
          tags: note.tags,
          origin: "imported",
          schedule: newSchedule(),
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
    const areaValue = {
      id: (options.createId ?? defaultId)(),
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
      cards,
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
      provenance: { format: "anki-apkg", deckNames: collection.deckNames, noteGuids },
    };
  });
}
