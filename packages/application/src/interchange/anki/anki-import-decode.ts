import { sha1 } from "@noble/hashes/legacy.js";
import { Effect, Either, Schema } from "effect";
import { MediaReferenceSchema } from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";
import {
  asRecord,
  decompressZstd,
  MAX_DATABASE_BYTES,
  MAX_EXPANDED_BYTES,
  MAX_MEDIA_ASSETS,
  MAX_MEDIA_BYTES,
  MAX_PROTO_BYTES,
  parseJson,
  parseMediaEntries,
  sha,
} from "./anki-import-archive";
import { mimeFor } from "./anki-import-media";
import type { AnkiImportError, AnkiPackageDatabaseFormat } from "./anki-import-contracts";

const MISSING = (reason: AnkiImportError["reason"]): AnkiImportError => ({
  _tag: "AnkiImportError",
  reason,
});

type DecodeDatabaseInput = {
  readonly archive: Readonly<Record<string, Uint8Array>>;
  readonly names: readonly string[];
  readonly databaseFormat: AnkiPackageDatabaseFormat;
  readonly databasePayload: Uint8Array;
  readonly mediaIndexBytes: Uint8Array;
};

export function decodePackageDatabaseAndMedia(
  input: DecodeDatabaseInput,
): Effect.Effect<
  { readonly database: Uint8Array; readonly mediaByName: ReadonlyMap<string, StoredMediaAsset> },
  AnkiImportError
> {
  return Effect.gen(function* () {
    const { archive, names, databaseFormat, databasePayload, mediaIndexBytes } = input;
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

    return { database, mediaByName };
  });
}
