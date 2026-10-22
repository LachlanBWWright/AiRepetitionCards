import { renderCloze } from "../../authoring/cloze";
import { importAnkiOcclusion } from "./anki-import-occlusion";
import { readAnkiPackage } from "./anki-import-package";
import { preserveAnkiSchedule } from "./anki-import-schedule";
import { importedAnkiNotes } from "./anki-import-notes";
import { renderAnkiTemplate } from "./anki-legacy-metadata";
import { Effect, Either, Schema } from "effect";
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
import { newSchedule, rebuildSchedule } from "@recall/scheduler";
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
    const { collection, mediaByName } = yield* readAnkiPackage(input, readSqlite);
    const noteTypes = new Map(collection.noteTypes.map((noteType) => [noteType.id, noteType]));
    const notes = new Map(collection.notes.map((note) => [note.id, note]));
    if (
      notes.size !== collection.notes.length ||
      new Set(collection.notes.map((note) => note.guid)).size !== collection.notes.length ||
      new Set(collection.cards.map((card) => `${String(card.noteId)}:${String(card.ordinal)}`))
        .size !== collection.cards.length ||
      noteTypes.size !== collection.noteTypes.length ||
      new Set(collection.cards.map((card) => card.id)).size !== collection.cards.length
    )
      return yield* Effect.fail(MISSING("invalid-database"));
    const objectiveId = createObjectiveId((options.createId ?? defaultId)());
    const cards: LearningArea["cards"][number][] = [];
    const cardIdsByAnkiId = new Map<number, LearningArea["cards"][number]["id"]>();
    const usedRefs = new Map<string, MediaReference>();
    const noteGuids = new Set<string>();
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
      if (fieldsByName.has("occlusion") && fieldsByName.has("image")) {
        const imported = importAnkiOcclusion(fieldsByName, card.ordinal, mediaByName);
        if (!imported) return yield* Effect.fail(MISSING("unsupported-note-type"));
        const importedCardId = createAssessmentId((options.createId ?? defaultId)());
        cardIdsByAnkiId.set(card.id, importedCardId);
        usedRefs.set(imported.attachment.reference.id, imported.attachment.reference);
        cards.push({
          id: importedCardId,
          sourceId: `anki:${note.guid}:${String(card.ordinal)}`,
          siblingId: `anki:${note.guid}`,
          front: imported.front,
          back: imported.back,
          objective: "Imported from Anki",
          objectiveIds: [objectiveId],
          tags: note.tags,
          origin: "imported",
          schedule: newSchedule(options.now),
          imageOcclusion: imported.image,
          media: [imported.attachment.reference],
        });
      } else if (noteType.kind === "basic") {
        const template = noteType.templates?.[card.ordinal];
        const templateFront = template
          ? renderAnkiTemplate(template.front, fieldsByName)
          : undefined;
        const frontRaw = template
          ? templateFront
          : fieldsByName.get(card.ordinal === 0 ? "front" : "back");
        const backRaw =
          template && templateFront !== undefined
            ? renderAnkiTemplate(template.back, fieldsByName, templateFront)
            : fieldsByName.get(card.ordinal === 0 ? "back" : "front");
        if (!template && card.ordinal > 1)
          return yield* Effect.fail(MISSING("unsupported-note-type"));
        if (frontRaw === undefined || backRaw === undefined)
          return yield* Effect.fail(MISSING("unsupported-note-type"));
        const first = sanitizeField(frontRaw, mediaByName);
        const second = sanitizeField(backRaw, mediaByName);
        if (first === "invalid-media" || second === "invalid-media")
          return yield* Effect.fail(MISSING("invalid-media"));
        if (!first || !second) return yield* Effect.fail(MISSING("invalid-note"));
        for (const ref of [...first.references, ...second.references]) usedRefs.set(ref.id, ref);
        const importedCardId = createAssessmentId((options.createId ?? defaultId)());
        cardIdsByAnkiId.set(card.id, importedCardId);
        cards.push({
          id: importedCardId,
          sourceId: `anki:${note.guid}:${String(card.ordinal)}`,
          siblingId: `anki:${note.guid}`,
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
        const rendered = yield* renderCloze(textRaw, card.ordinal + 1).pipe(
          Effect.mapError(() => MISSING("invalid-note")),
        );
        const front = sanitizeField(rendered.front, mediaByName);
        const back = sanitizeField(rendered.back, mediaByName);
        if (front === "invalid-media" || back === "invalid-media")
          return yield* Effect.fail(MISSING("invalid-media"));
        if (!front || !back) return yield* Effect.fail(MISSING("invalid-note"));
        for (const ref of [...front.references, ...back.references]) usedRefs.set(ref.id, ref);
        const importedCardId = createAssessmentId((options.createId ?? defaultId)());
        cardIdsByAnkiId.set(card.id, importedCardId);
        cards.push({
          id: importedCardId,
          sourceId: `anki:${note.guid}:${String(card.ordinal)}`,
          siblingId: `anki:${note.guid}`,
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
      noteGuids.add(note.guid);
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
        ...(review.elapsedMs !== undefined ? { elapsedMs: review.elapsedMs } : {}),
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
    const originalByCard = new Map(
      collection.cards.map((row) => [cardIdsByAnkiId.get(row.id), row.scheduling]),
    );
    const scheduledCards = yield* Effect.forEach(cards, (card) => {
      const original = originalByCard.get(card.id);
      const preserved = preserveAnkiSchedule(card, original, reviewsByCard.get(card.id) ?? []);
      if (preserved) return Effect.succeed(preserved);
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
      ...importedAnkiNotes(collection, scheduledCards, cardIdsByAnkiId, objectiveId, mediaByName),
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
      suspendedCardIds: collection.cards
        .filter((card) => card.scheduling?.suspended)
        .flatMap((card) => {
          const id = cardIdsByAnkiId.get(card.id);
          return id ? [id] : [];
        }),
      warnings: [
        "Matching Anki GUIDs and templates update existing content while preserving local scheduling and history. Ambiguous matches across areas are rejected.",
        "Static field templates are converted to safe text; styling and executable templates are not retained.",
        "Supported review and timestamp learning schedules retain due dates and intervals. Day-learning and suspended schedules are retained. Buried cards become available again; filtered queues rebuild from history. FSRS memory is retained when present, otherwise approximated from interval.",
      ],
      provenance: {
        format: "anki-apkg",
        deckNames: collection.deckNames,
        noteGuids: [...noteGuids],
      },
    };
  });
}
