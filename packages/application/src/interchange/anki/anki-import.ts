import { Effect, Either, Schema } from "effect";
import { unzipSync, type UnzipFileInfo } from "fflate";
import {
  LearningAreaSchema,
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  createReviewEventId,
  type LearningArea,
  type MediaReference,
} from "@recall/domain";
import { sanitizeField } from "./anki-import-media";
import { decodePackageDatabaseAndMedia } from "./anki-import-decode";
import { newSchedule, rebuildSchedule } from "@recall/scheduler";
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
import type { AnkiSqliteReader } from "./anki-import-contracts";

export { AnkiCollectionSchema } from "./anki-import-contracts";
export type {
  AnkiCardRow,
  AnkiCollection,
  AnkiImportError,
  AnkiImportProposal,
  AnkiNoteRow,
  AnkiNoteType,
  AnkiPackageDatabaseFormat,
  AnkiReviewRow,
  AnkiSqliteReader,
  AnkiSqliteReaderError,
} from "./anki-import-contracts";
import { AnkiCollectionSchema } from "./anki-import-contracts";
import type { AnkiImportError, AnkiImportProposal } from "./anki-import-contracts";

const MISSING = (reason: AnkiImportError["reason"]): AnkiImportError => ({
  _tag: "AnkiImportError",
  reason,
});

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
    const { database, mediaByName } = yield* decodePackageDatabaseAndMedia({
      archive,
      names,
      databaseFormat,
      databasePayload,
      mediaIndexBytes,
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
