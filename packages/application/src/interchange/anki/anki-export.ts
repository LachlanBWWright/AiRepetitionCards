import { areaMediaReferences } from "../../workspace/media/media-references";
import { Effect, Either, Schema } from "effect";
import { zipSync, strToU8 } from "fflate";
import {
  LearningAreaSchema,
  MAX_COLLECTION_CARDS,
  type LearningArea,
  type ReviewEvent,
} from "@recall/domain";
import type { MediaStore } from "@recall/local-store";
import { verifyMediaAsset } from "../knowledge-area-package";
import { buildAnkiExportStatements } from "./anki-export-statements";

export type AnkiExportFailure = {
  readonly _tag: "AnkiExportFailure";
  readonly reason: "invalid-area" | "limits-exceeded" | "media-unavailable" | "database-failed";
};
export type AnkiSqlStatement = {
  readonly sql: string;
  readonly parameters: readonly (string | number | null)[];
};
/** SQLite creation is platform-owned; application code only produces bound statements. */
export type AnkiSqliteWriter = (
  statements: readonly AnkiSqlStatement[],
) => Effect.Effect<Uint8Array, AnkiExportFailure>;
const failure = (reason: AnkiExportFailure["reason"]): AnkiExportFailure => ({
  _tag: "AnkiExportFailure",
  reason,
});
const extensions: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
};
export function ankiMediaName(id: string, mimeType: string): string {
  return `${id}.${extensions[mimeType] ?? "bin"}`;
}

/** Public exports reset schedules by default. Including learner scheduling is an explicit choice. */
export function exportAnkiApkg(
  input: unknown,
  mediaStore: MediaStore,
  writeSqlite: AnkiSqliteWriter,
  options: {
    readonly now: Date;
    readonly includeScheduling?: boolean;
    readonly reviewEvents?: readonly ReviewEvent[];
    readonly suspendedCardIds?: readonly string[];
  },
): Effect.Effect<Uint8Array, AnkiExportFailure> {
  return Effect.gen(function* () {
    const decoded = Schema.decodeUnknownEither(LearningAreaSchema)(input);
    if (Either.isLeft(decoded) || !Number.isSafeInteger(options.now.getTime()))
      return yield* Effect.fail(failure("invalid-area"));
    const area: LearningArea = decoded.right;
    const cardIds = new Set(area.cards.map((card) => card.id));
    const events = options.includeScheduling
      ? (options.reviewEvents ?? []).filter((event) => cardIds.has(event.cardId))
      : [];
    if (events.length > 250_000) return yield* Effect.fail(failure("limits-exceeded"));
    const times = events.map((event) => Date.parse(event.effectiveReviewedAt ?? event.ratedAt));
    if (
      times.some((time) => !Number.isSafeInteger(time) || time <= 0) ||
      new Set(times).size !== times.length
    )
      return yield* Effect.fail(failure("invalid-area"));
    const textSize = area.cards.reduce(
      (size, card) => size + card.front.length + card.back.length,
      0,
    );
    if (
      area.cards.length === 0 ||
      area.cards.length > MAX_COLLECTION_CARDS ||
      textSize > 20_000_000
    )
      return yield* Effect.fail(failure("limits-exceeded"));
    const refs = areaMediaReferences(area);
    const files: Record<string, Uint8Array> = {};
    const media: Record<string, string> = {};
    let total = 0;
    for (const [index, ref] of refs.entries()) {
      const asset = yield* mediaStore
        .get(ref.id)
        .pipe(Effect.mapError(() => failure("media-unavailable")));
      if (
        !asset ||
        asset.reference.mimeType !== ref.mimeType ||
        asset.bytes.length !== ref.byteLength ||
        asset.reference.id !== ref.id ||
        !verifyMediaAsset(asset)
      )
        return yield* Effect.fail(failure("media-unavailable"));
      total += asset.bytes.length;
      if (total > 100_000_000) return yield* Effect.fail(failure("limits-exceeded"));
      files[String(index)] = asset.bytes;
      media[String(index)] = ankiMediaName(ref.id, ref.mimeType);
    }
    files["collection.anki2"] = yield* writeSqlite(buildAnkiExportStatements(area, options));
    if (files["collection.anki2"].length > 80_000_000)
      return yield* Effect.fail(failure("limits-exceeded"));
    files.media = strToU8(JSON.stringify(media));
    const archive = yield* Effect.try({
      try: () => zipSync(files, { level: 6 }),
      catch: () => failure("database-failed"),
    });
    if (archive.length > 50_000_000) return yield* Effect.fail(failure("limits-exceeded"));
    return archive;
  });
}
