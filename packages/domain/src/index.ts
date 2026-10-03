import { Effect, Either, Schema } from "effect";
import {
  AreaIdSchema,
  CardIdSchema,
  DeviceIdSchema,
  MediaIdSchema,
  ObjectiveIdSchema,
  ReviewEventIdSchema,
} from "./ids";

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
  id: ObjectiveIdSchema,
  title: Schema.String.pipe(Schema.minLength(1)),
  description: Schema.NullOr(Schema.String),
  prerequisiteIds: Schema.Array(ObjectiveIdSchema),
  sourceId: Schema.optional(Schema.String),
});

export const ClozeContentSchema = Schema.Struct({
  text: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(20_000)),
  deletionIndex: Schema.Number.pipe(Schema.int(), Schema.between(1, 20)),
});
export type ClozeContent = typeof ClozeContentSchema.Type;

export const StudyCardSchema = Schema.Struct({
  id: CardIdSchema,
  front: Schema.String.pipe(Schema.minLength(1)),
  back: Schema.String.pipe(Schema.minLength(1)),
  objective: Schema.String.pipe(Schema.minLength(1)),
  schedule: CardSchedule,
  cloze: Schema.optional(ClozeContentSchema),
  objectiveIds: Schema.optional(Schema.Array(ObjectiveIdSchema)),
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
  id: AreaIdSchema,
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
  sourceId: Schema.optional(Schema.String),
});

const ClozeKnowledgeCardSchema = Schema.Struct({
  kind: Schema.Literal("cloze"),
  id: CardIdSchema,
  text: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(20_000)),
  deletionIndex: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 20))),
  objectiveIds: Schema.Array(ObjectiveIdSchema),
  media: Schema.optional(Schema.Array(MediaReferenceSchema).pipe(Schema.maxItems(20))),
  tags: Schema.Array(Schema.String),
  origin: CardOriginSchema,
  sourceId: Schema.optional(Schema.String),
});

const KnowledgeCardSchema = Schema.Union(BasicKnowledgeCardSchema, ClozeKnowledgeCardSchema);

const KnowledgeObjectiveSchema = Schema.Struct({
  id: ObjectiveIdSchema,
  title: Schema.String.pipe(Schema.minLength(1)),
  description: Schema.NullOr(Schema.String),
  prerequisiteIds: Schema.Array(ObjectiveIdSchema),
  sourceId: Schema.optional(Schema.String),
});

const currentKnowledgeAreaVersion = "1.0.0" as const;

export const KnowledgeAreaSchema = Schema.Struct({
  schemaVersion: Schema.Literal(currentKnowledgeAreaVersion),
  id: AreaIdSchema,
  sourceId: Schema.optional(Schema.String),
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

/** The first portable Knowledge Area shape, before language, AI policy, and card metadata. */
const KnowledgeAreaV0_9Schema = Schema.Struct({
  schemaVersion: Schema.Literal("0.9.0"),
  id: AreaIdSchema,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  description: Schema.NullOr(Schema.String),
  objectives: Schema.Array(KnowledgeObjectiveSchema).pipe(Schema.maxItems(200)),
  cards: Schema.Array(
    Schema.Struct({
      id: CardIdSchema,
      front: Schema.String.pipe(Schema.minLength(1)),
      back: Schema.String.pipe(Schema.minLength(1)),
      objectiveIds: Schema.Array(ObjectiveIdSchema),
    }),
  ).pipe(Schema.maxItems(500)),
});

export const ReviewEventSchema = Schema.Struct({
  id: ReviewEventIdSchema,
  areaId: AreaIdSchema,
  cardId: CardIdSchema,
  ratedAt: Schema.String.pipe(Schema.minLength(1)),
  rating: Schema.Union(
    Schema.Literal("again"),
    Schema.Literal("hard"),
    Schema.Literal("good"),
    Schema.Literal("easy"),
  ),
  schedulerFamily: Schema.Literal("fsrs"),
  schedulerVersion: Schema.String.pipe(Schema.minLength(1)),
  deviceId: Schema.optional(DeviceIdSchema),
  deviceSequence: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  baseReviewEventId: Schema.optional(Schema.NullOr(ReviewEventIdSchema)),
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

/** Private study preferences. These are never part of a shared KnowledgeArea. */
export const SchedulerSettingsSchema = Schema.Struct({
  requestRetention: Schema.Number.pipe(Schema.between(0.7, 0.97)),
});

const AccountUuidSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);
export const AccountIdSchema = Schema.transform(AccountUuidSchema, AccountUuidSchema, {
  strict: true,
  decode: (value) => value.toLowerCase(),
  encode: (value) => value.toLowerCase(),
});

export const WorkspaceSchema = Schema.Struct({
  retainedReviewAreas: Schema.optional(Schema.Array(LearningAreaSchema)),
  schemaVersion: Schema.Literal(1),
  areas: Schema.Array(LearningAreaSchema),
  reviews: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  reviewEvents: Schema.optional(Schema.Array(ReviewEventSchema)),
  schedulerSettings: Schema.optional(SchedulerSettingsSchema),
  syncOwnerId: Schema.optional(AccountIdSchema),
  syncDeviceId: Schema.optional(DeviceIdSchema),
  pendingReviewEventIds: Schema.optional(Schema.Array(ReviewEventIdSchema)),
  reviewConflictIds: Schema.optional(Schema.Array(ReviewEventIdSchema)),
  deletedCards: Schema.optional(
    Schema.Array(Schema.Struct({ areaId: AreaIdSchema, cardId: CardIdSchema })),
  ),
  deletedAreas: Schema.optional(
    Schema.Array(
      Schema.Struct({
        areaId: AreaIdSchema,
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
  syncHasMore: Schema.optional(Schema.Boolean),
  syncContentConflictAreaIds: Schema.optional(Schema.Array(AreaIdSchema)),
  syncPendingContentAreaIds: Schema.optional(Schema.Array(AreaIdSchema)),
}).pipe(
  Schema.filter(
    (workspace) => {
      const retained = workspace.retainedReviewAreas ?? [];
      const active = new Set(workspace.areas.flatMap((area) => area.cards.map((card) => card.id)));
      const cardIds = retained.flatMap((area) => area.cards.map((card) => card.id));
      return (
        new Set(retained.map((area) => area.id)).size === retained.length &&
        new Set(cardIds).size === cardIds.length &&
        retained.every((area) => {
          const objectives = new Set((area.objectives ?? []).map((objective) => objective.id));
          return (
            objectives.size === (area.objectives ?? []).length &&
            (area.objectives ?? []).every((objective) =>
              objective.prerequisiteIds.every((id) => objectives.has(id)),
            ) &&
            area.cards.every(
              (card) =>
                !active.has(card.id) &&
                (card.objectiveIds ?? []).every((id) => objectives.has(id)) &&
                (workspace.reviewEvents ?? []).some(
                  (event) => event.areaId === area.id && event.cardId === card.id,
                ) &&
                ((workspace.deletedAreas ?? []).some((item) => item.areaId === area.id) ||
                  (workspace.deletedCards ?? []).some(
                    (item) => item.areaId === area.id && item.cardId === card.id,
                  )),
            )
          );
        })
      );
    },
    { message: () => "Retained deleted review content has invalid identities or references." },
  ),
);

export type StudyCard = typeof StudyCardSchema.Type;
export type LearningArea = typeof LearningAreaSchema.Type;
export type ReviewEvent = typeof ReviewEventSchema.Type;
export type Workspace = typeof WorkspaceSchema.Type;
export type SchedulerSettings = typeof SchedulerSettingsSchema.Type;
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

const knowledgeAreaDecodeFailure = (
  reason: KnowledgeAreaDecodeError["reason"],
): KnowledgeAreaDecodeError => ({ _tag: "KnowledgeAreaDecodeError", reason });

export const decodeKnowledgeArea = Schema.decodeUnknown(KnowledgeAreaSchema);

type KnowledgeAreaMigration = {
  readonly toVersion: string;
  readonly migrate: (input: unknown) => Effect.Effect<unknown, KnowledgeAreaDecodeError>;
};

const versionOfKnowledgeArea = (input: unknown): string | null => {
  if (typeof input !== "object" || input === null || !("schemaVersion" in input)) return null;
  return typeof input.schemaVersion === "string" ? input.schemaVersion : null;
};

const migrateKnowledgeAreaV0_9: KnowledgeAreaMigration["migrate"] = (input) => {
  const previous = Schema.decodeUnknownEither(KnowledgeAreaV0_9Schema)(input);
  if (Either.isLeft(previous)) return Effect.fail(knowledgeAreaDecodeFailure("invalid-shape"));
  const old = previous.right;
  return Effect.succeed({
    schemaVersion: currentKnowledgeAreaVersion,
    id: old.id,
    title: old.title,
    description: old.description,
    language: "en",
    objectives: old.objectives,
    ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
    cards: old.cards.map((card) => ({
      ...card,
      kind: "basic",
      tags: [],
      origin: "imported",
    })),
    tags: [],
    licence: null,
  });
};

/** Each entry performs one declared version step; add a step here when a version becomes supported. */
const knowledgeAreaMigrations: Readonly<Record<string, KnowledgeAreaMigration>> = {
  "0.9.0": { toVersion: currentKnowledgeAreaVersion, migrate: migrateKnowledgeAreaV0_9 },
};

function migrateKnowledgeAreaVersion(
  version: string,
  input: unknown,
  visited: ReadonlySet<string>,
): Effect.Effect<KnowledgeArea, KnowledgeAreaDecodeError> {
  if (version === currentKnowledgeAreaVersion) {
    return decodeKnowledgeArea(input).pipe(
      Effect.mapError(() => knowledgeAreaDecodeFailure("invalid-shape")),
    );
  }
  const migration = knowledgeAreaMigrations[version];
  if (!migration || visited.has(version)) {
    return Effect.fail(knowledgeAreaDecodeFailure("unsupported-version"));
  }
  return migration.migrate(input).pipe(
    Effect.flatMap((next) => {
      if (versionOfKnowledgeArea(next) !== migration.toVersion) {
        return Effect.fail(knowledgeAreaDecodeFailure("invalid-shape"));
      }
      return migrateKnowledgeAreaVersion(migration.toVersion, next, new Set([...visited, version]));
    }),
  );
}

/** Decode a portable document through explicit, deterministic version steps. */
export const decodeAndMigrateKnowledgeArea = (
  input: unknown,
): Effect.Effect<KnowledgeArea, KnowledgeAreaDecodeError> => {
  const version = versionOfKnowledgeArea(input);
  return version === null
    ? Effect.fail(knowledgeAreaDecodeFailure("invalid-shape"))
    : migrateKnowledgeAreaVersion(version, input, new Set());
};

export const parseKnowledgeAreaJson = (raw: string) =>
  Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: (): KnowledgeAreaDecodeError => ({
      _tag: "KnowledgeAreaDecodeError",
      reason: "invalid-json",
    }),
  }).pipe(
    Effect.flatMap((input) => decodeAndMigrateKnowledgeArea(input)),
    Effect.flatMap((area) => {
      const objectiveIdList = area.objectives.map((objective) => objective.id);
      const objectiveIds = new Set(objectiveIdList);
      const cardIds = area.cards.map((card) => card.id);
      const objectiveReferences = area.objectives.flatMap((objective) => objective.prerequisiteIds);
      const cardReferences = area.cards.flatMap((card) => card.objectiveIds);
      const allIds = [...objectiveIdList, ...cardIds];
      const hasDuplicateIds = new Set(allIds).size !== allIds.length;
      if (hasDuplicateIds) {
        return Effect.fail(knowledgeAreaDecodeFailure("duplicate-id"));
      }
      if (
        objectiveReferences.some((id) => !objectiveIds.has(id)) ||
        cardReferences.some((id) => !objectiveIds.has(id))
      ) {
        return Effect.fail(knowledgeAreaDecodeFailure("unknown-reference"));
      }
      return Effect.succeed(area);
    }),
  );
