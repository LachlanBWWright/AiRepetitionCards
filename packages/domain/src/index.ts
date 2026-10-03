import { Effect, Either, Schema } from "effect";
import { AreaIdSchema, CardIdSchema, MediaIdSchema, ObjectiveIdSchema } from "./ids";

export * from "./ids";

export const MediaMimeTypeSchema = Schema.Union(
  Schema.Literal("image/jpeg"),
  Schema.Literal("image/png"),
  Schema.Literal("image/gif"),
  Schema.Literal("image/webp"),
  Schema.Literal("audio/mpeg"),
  Schema.Literal("audio/ogg"),
  Schema.Literal("audio/wav"),
);
export type MediaMimeType = typeof MediaMimeTypeSchema.Type;

export const MediaReferenceSchema = Schema.Struct({
  id: MediaIdSchema,
  mimeType: MediaMimeTypeSchema,
  byteLength: Schema.Number.pipe(
    Schema.int(),
    Schema.positive(),
    Schema.lessThanOrEqualTo(20_000_000),
  ),
});
export type MediaReference = typeof MediaReferenceSchema.Type;

const CardSchedule = Schema.Struct({
  due: Schema.String,
  stability: Schema.Number,
  difficulty: Schema.Number,
  elapsed_days: Schema.Number,
  scheduled_days: Schema.Number,
  learning_steps: Schema.Number,
  reps: Schema.Number,
  lapses: Schema.Number,
  state: Schema.Union(Schema.Literal(0), Schema.Literal(1), Schema.Literal(2), Schema.Literal(3)),
  last_review: Schema.optional(Schema.NullOr(Schema.String)),
});
export type CardSchedule = typeof CardSchedule.Type;

export const LearningObjectiveSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  title: Schema.String.pipe(Schema.minLength(1)),
  description: Schema.NullOr(Schema.String),
  prerequisiteIds: Schema.Array(Schema.String),
  sourceId: Schema.optional(Schema.String),
});

export const StudyCardSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  front: Schema.String.pipe(Schema.minLength(1)),
  back: Schema.String.pipe(Schema.minLength(1)),
  objective: Schema.String.pipe(Schema.minLength(1)),
  schedule: CardSchedule,
  objectiveIds: Schema.optional(Schema.Array(Schema.String)),
  media: Schema.optional(Schema.Array(MediaReferenceSchema).pipe(Schema.maxItems(20))),
  tags: Schema.optional(Schema.Array(Schema.String)),
  origin: Schema.optional(
    Schema.Union(
      Schema.Literal("authored"),
      Schema.Literal("imported"),
      Schema.Literal("ai-generated"),
    ),
  ),
  sourceId: Schema.optional(Schema.String),
});

export const LearningAreaSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  color: Schema.String.pipe(Schema.pattern(/^#[0-9a-fA-F]{6}$/)),
  cards: Schema.Array(StudyCardSchema),
  objectives: Schema.optional(Schema.Array(LearningObjectiveSchema)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  language: Schema.optional(Schema.String),
  ai: Schema.optional(
    Schema.Struct({
      tutorInstructions: Schema.String,
      quizInstructions: Schema.NullOr(Schema.String),
      cardGenerationInstructions: Schema.NullOr(Schema.String),
    }),
  ),
  tags: Schema.optional(Schema.Array(Schema.String)),
  licence: Schema.optional(Schema.NullOr(Schema.String)),
  attribution: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(500)))),
  forkedFromVersionId: Schema.optional(Schema.String.pipe(Schema.maxLength(80))),
  sourceId: Schema.optional(Schema.String),
});

const CardOriginSchema = Schema.Union(
  Schema.Literal("authored"),
  Schema.Literal("imported"),
  Schema.Literal("ai-generated"),
);

const BasicKnowledgeCardSchema = Schema.Struct({
  kind: Schema.Literal("basic"),
  id: CardIdSchema,
  front: Schema.String.pipe(Schema.minLength(1)),
  back: Schema.String.pipe(Schema.minLength(1)),
  objectiveIds: Schema.Array(ObjectiveIdSchema),
  media: Schema.optional(Schema.Array(MediaReferenceSchema).pipe(Schema.maxItems(20))),
  tags: Schema.Array(Schema.String),
  origin: CardOriginSchema,
});

const ClozeKnowledgeCardSchema = Schema.Struct({
  kind: Schema.Literal("cloze"),
  id: CardIdSchema,
  text: Schema.String.pipe(Schema.minLength(1)),
  objectiveIds: Schema.Array(ObjectiveIdSchema),
  media: Schema.optional(Schema.Array(MediaReferenceSchema).pipe(Schema.maxItems(20))),
  tags: Schema.Array(Schema.String),
  origin: CardOriginSchema,
});

const KnowledgeCardSchema = Schema.Union(BasicKnowledgeCardSchema, ClozeKnowledgeCardSchema);

const KnowledgeObjectiveSchema = Schema.Struct({
  id: ObjectiveIdSchema,
  title: Schema.String.pipe(Schema.minLength(1)),
  description: Schema.NullOr(Schema.String),
  prerequisiteIds: Schema.Array(ObjectiveIdSchema),
  sourceId: Schema.optional(Schema.String),
});

export const KnowledgeAreaSchema = Schema.Struct({
  schemaVersion: Schema.Literal("1.0.0"),
  id: AreaIdSchema,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  description: Schema.NullOr(Schema.String),
  language: Schema.String.pipe(Schema.minLength(1)),
  objectives: Schema.Array(KnowledgeObjectiveSchema).pipe(Schema.maxItems(200)),
  ai: Schema.Struct({
    tutorInstructions: Schema.String.pipe(Schema.maxLength(2_000)),
    quizInstructions: Schema.NullOr(Schema.String.pipe(Schema.maxLength(2_000))),
    cardGenerationInstructions: Schema.NullOr(Schema.String.pipe(Schema.maxLength(2_000))),
  }),
  cards: Schema.Array(KnowledgeCardSchema).pipe(Schema.maxItems(500)),
  tags: Schema.Array(Schema.String),
  licence: Schema.NullOr(Schema.String),
  attribution: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(500)))),
  forkedFromVersionId: Schema.optional(Schema.String.pipe(Schema.maxLength(80))),
});

export const ReviewEventSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  areaId: Schema.String.pipe(Schema.minLength(1)),
  cardId: Schema.String.pipe(Schema.minLength(1)),
  ratedAt: Schema.String.pipe(Schema.minLength(1)),
  rating: Schema.Union(
    Schema.Literal("again"),
    Schema.Literal("hard"),
    Schema.Literal("good"),
    Schema.Literal("easy"),
  ),
  schedulerFamily: Schema.Literal("fsrs"),
  schedulerVersion: Schema.String.pipe(Schema.minLength(1)),
  deviceId: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  deviceSequence: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  baseReviewEventId: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.minLength(1)))),
  reviewedAtDevice: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  effectiveReviewedAt: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  elapsedMs: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.nonNegative()))),
  schedulerParameterSetId: Schema.optional(Schema.NullOr(Schema.String)),
  previousStateHash: Schema.optional(Schema.NullOr(Schema.String)),
});

export const LegacyWorkspaceSchema = Schema.Struct({
  areas: Schema.Array(LearningAreaSchema),
  reviews: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  reviewEvents: Schema.optional(Schema.Array(ReviewEventSchema)),
});

export const WorkspaceSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  areas: Schema.Array(LearningAreaSchema),
  reviews: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  reviewEvents: Schema.optional(Schema.Array(ReviewEventSchema)),
  syncDeviceId: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  pendingReviewEventIds: Schema.optional(Schema.Array(Schema.String.pipe(Schema.minLength(1)))),
  reviewConflictIds: Schema.optional(Schema.Array(Schema.String.pipe(Schema.minLength(1)))),
  deletedCards: Schema.optional(
    Schema.Array(Schema.Struct({ areaId: Schema.String, cardId: Schema.String })),
  ),
  deletedAreas: Schema.optional(
    Schema.Array(
      Schema.Struct({
        areaId: Schema.String.pipe(Schema.minLength(1)),
        baseContentHash: Schema.optional(Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/i))),
        synced: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
  syncContentHashes: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/i)),
    }),
  ),
  syncCursor: Schema.optional(Schema.String.pipe(Schema.pattern(/^\d+$/))),
});

export type StudyCard = typeof StudyCardSchema.Type;
export type LearningArea = typeof LearningAreaSchema.Type;
export type ReviewEvent = typeof ReviewEventSchema.Type;
export type Workspace = typeof WorkspaceSchema.Type;
export type LegacyWorkspace = typeof LegacyWorkspaceSchema.Type;
export type KnowledgeArea = typeof KnowledgeAreaSchema.Type;

export type WorkspaceDecodeError = {
  readonly _tag: "WorkspaceDecodeError";
  readonly reason: "invalid-json" | "invalid-shape" | "unsupported-version";
};

export const decodeWorkspace = Schema.decodeUnknown(WorkspaceSchema);

function decodeWorkspaceVersion1(input: unknown): Effect.Effect<Workspace, WorkspaceDecodeError> {
  const decoded = Schema.decodeUnknownEither(WorkspaceSchema)(input);
  return Either.isLeft(decoded)
    ? Effect.fail({ _tag: "WorkspaceDecodeError", reason: "invalid-shape" })
    : Effect.succeed(decoded.right);
}

export const parseWorkspaceJson = (raw: string) =>
  Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: () => ({ _tag: "WorkspaceDecodeError", reason: "invalid-json" }) as const,
  }).pipe(
    Effect.flatMap((input) => {
      const version =
        typeof input === "object" && input !== null && "schemaVersion" in input
          ? input.schemaVersion
          : undefined;
      if (version === 1) return decodeWorkspaceVersion1(input);
      if (version !== undefined) {
        return Effect.fail({
          _tag: "WorkspaceDecodeError",
          reason: "unsupported-version",
        } as const);
      }

      const legacy = Schema.decodeUnknownEither(LegacyWorkspaceSchema)(input);
      if (Either.isLeft(legacy)) {
        return Effect.fail({ _tag: "WorkspaceDecodeError", reason: "invalid-shape" } as const);
      }
      return Effect.succeed({ schemaVersion: 1 as const, ...legacy.right });
    }),
  );

export type KnowledgeAreaDecodeError = {
  readonly _tag: "KnowledgeAreaDecodeError";
  readonly reason:
    "invalid-json" | "invalid-shape" | "unsupported-version" | "duplicate-id" | "unknown-reference";
};

export const decodeKnowledgeArea = Schema.decodeUnknown(KnowledgeAreaSchema);

export const parseKnowledgeAreaJson = (raw: string) =>
  Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: () =>
      ({ _tag: "KnowledgeAreaDecodeError", reason: "invalid-json" }) as KnowledgeAreaDecodeError,
  }).pipe(
    Effect.flatMap((input) => {
      const schemaVersion =
        typeof input === "object" && input !== null && "schemaVersion" in input
          ? input.schemaVersion
          : undefined;
      if (typeof schemaVersion !== "string") {
        return Effect.fail({
          _tag: "KnowledgeAreaDecodeError",
          reason: "invalid-shape",
        } as const);
      }
      if (!/^\d+\.\d+\.\d+$/.test(schemaVersion) || schemaVersion !== "1.0.0") {
        return Effect.fail({
          _tag: "KnowledgeAreaDecodeError",
          reason: "unsupported-version",
        } as const);
      }
      const decoded = Schema.decodeUnknownEither(KnowledgeAreaSchema)(input);
      if (Either.isLeft(decoded)) {
        return Effect.fail({
          _tag: "KnowledgeAreaDecodeError",
          reason: "invalid-shape",
        } as KnowledgeAreaDecodeError);
      }
      const area = decoded.right;
      const objectiveIdList = area.objectives.map((objective) => objective.id);
      const objectiveIds = new Set(objectiveIdList);
      const cardIds = area.cards.map((card) => card.id);
      const objectiveReferences = area.objectives.flatMap((objective) => objective.prerequisiteIds);
      const cardReferences = area.cards.flatMap((card) => card.objectiveIds);
      const allIds = [...objectiveIdList, ...cardIds];
      const hasDuplicateIds = new Set(allIds).size !== allIds.length;
      if (hasDuplicateIds) {
        return Effect.fail({
          _tag: "KnowledgeAreaDecodeError",
          reason: "duplicate-id",
        } as KnowledgeAreaDecodeError);
      }
      if (
        objectiveReferences.some((id) => !objectiveIds.has(id)) ||
        cardReferences.some((id) => !objectiveIds.has(id))
      ) {
        return Effect.fail({
          _tag: "KnowledgeAreaDecodeError",
          reason: "unknown-reference",
        } as KnowledgeAreaDecodeError);
      }
      return Effect.succeed(area);
    }),
  );
