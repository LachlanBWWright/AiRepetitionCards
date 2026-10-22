import { Effect, Schema } from "effect";
import { MAX_COLLECTION_CARDS, MAX_COLLECTION_NOTES, type LearningArea } from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";

const MAX_FIELD_CHARS = 500_000;
const MAX_NOTES = MAX_COLLECTION_NOTES;
const MAX_CARDS = MAX_COLLECTION_CARDS;

/** The adapter boundary keeps SQLite/WASM/native packages out of the application package. */
export type AnkiNoteType = {
  readonly id: number;
  readonly name: string;
  readonly kind: "basic" | "cloze" | "unsupported";
  readonly fields: readonly string[];
  readonly templates?:
    | readonly {
        readonly name: string;
        readonly front: string;
        readonly back: string;
      }[]
    | undefined;
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
  readonly scheduling?:
    | {
        readonly due: string;
        readonly interval: number;
        readonly reps: number;
        readonly lapses: number;
        readonly state: 0 | 1 | 2 | 3;
        readonly stability?: number | undefined;
        readonly difficulty?: number | undefined;
        readonly lastReview?: string | undefined;
        readonly suspended?: boolean | undefined;
      }
    | undefined;
};
export type AnkiReviewRow = {
  readonly elapsedMs?: number | undefined;
  readonly cardId: number;
  readonly reviewedAt: number;
  /** Anki ease grade: 1 (again) through 4 (easy). */
  readonly ease: number;
  /** Anki revlog type: learning, review, relearning, cram, or administrative reschedule. */
  readonly type: number;
};
export type AnkiCollection = {
  readonly deckNames: readonly string[];
  readonly noteTypes: readonly AnkiNoteType[];
  readonly notes: readonly AnkiNoteRow[];
  readonly cards: readonly AnkiCardRow[];
  readonly reviews?: readonly AnkiReviewRow[] | undefined;
};
export type AnkiSqliteReaderError = {
  readonly _tag: "AnkiSqliteReaderError";
  readonly reason: "unsupported-database" | "invalid-database" | "limits-exceeded";
};
export type AnkiSqliteReader = (
  database: Uint8Array,
) => Effect.Effect<unknown, AnkiSqliteReaderError>;

export const AnkiCollectionSchema = Schema.Struct({
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
      templates: Schema.optional(
        Schema.Array(
          Schema.Struct({
            name: Schema.String,
            front: Schema.String.pipe(Schema.maxLength(MAX_FIELD_CHARS)),
            back: Schema.String.pipe(Schema.maxLength(MAX_FIELD_CHARS)),
          }),
        ).pipe(Schema.maxItems(100)),
      ),
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
      scheduling: Schema.optional(
        Schema.Struct({
          stability: Schema.optional(Schema.Number.pipe(Schema.finite(), Schema.positive())),
          difficulty: Schema.optional(Schema.Number.pipe(Schema.finite(), Schema.between(1, 10))),
          lastReview: Schema.optional(Schema.String),
          suspended: Schema.optional(Schema.Boolean),
          due: Schema.String,
          interval: Schema.Number.pipe(Schema.finite(), Schema.nonNegative()),
          reps: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
          lapses: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
          state: Schema.Union(
            Schema.Literal(0),
            Schema.Literal(1),
            Schema.Literal(2),
            Schema.Literal(3),
          ),
        }),
      ),
    }),
  ).pipe(Schema.maxItems(MAX_CARDS)),
  reviews: Schema.optional(
    Schema.Array(
      Schema.Struct({
        cardId: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
        elapsedMs: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
        reviewedAt: Schema.Number.pipe(Schema.finite(), Schema.positive()),
        ease: Schema.Number.pipe(Schema.int(), Schema.between(0, 4)),
        type: Schema.Number.pipe(Schema.int(), Schema.between(0, 4)),
      }),
    ).pipe(Schema.maxItems(250_000)),
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
  readonly suspendedCardIds?: readonly import("@recall/domain").AssessmentId[];
  readonly warnings?: readonly string[];
  readonly provenance: {
    readonly format: "anki-apkg";
    readonly deckNames: readonly string[];
    readonly noteGuids: readonly string[];
  };
};

/** Database container selected from the ZIP entries in an Anki deck package. */
export type AnkiPackageDatabaseFormat = "legacy-anki2" | "anki21" | "anki21b";
