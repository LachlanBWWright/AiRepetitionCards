import { extractAnkiArchive } from "./anki-import-extract";
import { Effect, Either, Schema } from "effect";
import { unzipSync, type UnzipFileInfo } from "fflate";
import { decodePackageDatabaseAndMedia } from "./anki-import-decode";
import { hasSafeZipExpansion } from "../zip-safety";
import {
  MAX_ARCHIVE_BYTES,
  MAX_DATABASE_BYTES,
  MAX_EXPANDED_BYTES,
  MAX_FILES,
  parsePackageVersion,
  validArchivePath,
  ZIP_SIGNATURE,
} from "./anki-import-archive";
import {
  AnkiCollectionSchema,
  type AnkiCollection,
  type AnkiImportError,
  type AnkiSqliteReader,
  type AnkiImportControl,
} from "./anki-import-contracts";
const MISSING = (reason: AnkiImportError["reason"]): AnkiImportError => ({
  _tag: "AnkiImportError",
  reason,
});
export function readAnkiPackage(
  input: unknown,
  readSqlite: AnkiSqliteReader,
  control: AnkiImportControl = {},
): Effect.Effect<
  {
    readonly collection: AnkiCollection;
    readonly mediaByName: ReadonlyMap<string, import("@recall/local-store").StoredMediaAsset>;
  },
  AnkiImportError
> {
  return Effect.gen(function* () {
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
    if (
      zipEntries.some((entry) => !validArchivePath(entry.name)) ||
      new Set(zipEntries.map((entry) => entry.name)).size !== zipEntries.length
    )
      return yield* Effect.fail(MISSING("invalid-archive"));
    const archive = yield* extractAnkiArchive(input, control);
    const names = Object.keys(archive);
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
    const { database, mediaByName } = yield* decodePackageDatabaseAndMedia({
      archive,
      names,
      databaseFormat,
      databasePayload,
      mediaIndexBytes,
      control,
      releaseEntry: (name) => {
        Reflect.deleteProperty(archive, name);
      },
    });
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
    return { collection: decodedCollection.right, mediaByName };
  });
}
