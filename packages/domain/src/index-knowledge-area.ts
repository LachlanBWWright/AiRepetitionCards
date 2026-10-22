import { MAX_COLLECTION_CARDS } from "./collection-capacity";
import { Effect, Either, Schema } from "effect";
import { ReviewPresentationSchema } from "./review-presentation";
import { ImageOcclusionSchema } from "./image-occlusion";
import { NoteLibrarySchema } from "./notes";
import { MediaReferenceSchema } from "./media";
import { LearningActivitySchema } from "./learning-activities";
import { AreaIdSchema, AssessmentIdSchema, ObjectiveIdSchema } from "./ids";

export { MediaMimeTypeSchema, MediaReferenceSchema } from "./media";
export type { MediaMimeType, MediaReference } from "./media";

const AssessmentOriginSchema = Schema.Union(
  Schema.Literal("authored"),
  Schema.Literal("imported"),
  Schema.Literal("ai-generated"),
);

export const FlashcardAssessmentContentSchema = Schema.Struct({
  kind: Schema.Literal("basic"),
  presentation: Schema.optional(ReviewPresentationSchema),
  imageOcclusion: Schema.optional(ImageOcclusionSchema),
  id: AssessmentIdSchema,
  noteId: Schema.optional(Schema.String),
  templateId: Schema.optional(Schema.String),
  front: Schema.String.pipe(Schema.minLength(1)),
  back: Schema.String.pipe(Schema.minLength(1)),
  objectiveIds: Schema.Array(ObjectiveIdSchema),
  media: Schema.optional(Schema.Array(MediaReferenceSchema).pipe(Schema.maxItems(20))),
  tags: Schema.Array(Schema.String),
  origin: AssessmentOriginSchema,
  sourceId: Schema.optional(Schema.String),
});

export const ClozeAssessmentContentSchema = Schema.Struct({
  kind: Schema.Literal("cloze"),
  presentation: Schema.optional(ReviewPresentationSchema),
  imageOcclusion: Schema.optional(ImageOcclusionSchema),
  id: AssessmentIdSchema,
  noteId: Schema.optional(Schema.String),
  templateId: Schema.optional(Schema.String),
  text: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(20_000)),
  deletionIndex: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 20))),
  objectiveIds: Schema.Array(ObjectiveIdSchema),
  media: Schema.optional(Schema.Array(MediaReferenceSchema).pipe(Schema.maxItems(20))),
  tags: Schema.Array(Schema.String),
  origin: AssessmentOriginSchema,
  sourceId: Schema.optional(Schema.String),
});

/** Portable exercise content, separate from its review schedule and history. */
export const AssessmentContentSchema = Schema.Union(
  FlashcardAssessmentContentSchema,
  ClozeAssessmentContentSchema,
);
export type AssessmentContent = typeof AssessmentContentSchema.Type;

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
  difficulty: Schema.optional(
    Schema.Union(
      Schema.Literal("beginner"),
      Schema.Literal("intermediate"),
      Schema.Literal("advanced"),
    ),
  ),
  objectives: Schema.Array(KnowledgeObjectiveSchema).pipe(Schema.maxItems(200)),
  ai: Schema.Struct({
    tutorInstructions: Schema.String.pipe(Schema.maxLength(2_000)),
    quizInstructions: Schema.NullOr(Schema.String.pipe(Schema.maxLength(2_000))),
    cardGenerationInstructions: Schema.NullOr(Schema.String.pipe(Schema.maxLength(2_000))),
  }),
  noteLibrary: Schema.optional(NoteLibrarySchema),
  cards: Schema.Array(AssessmentContentSchema).pipe(Schema.maxItems(MAX_COLLECTION_CARDS)),
  tags: Schema.Array(Schema.String),
  licence: Schema.NullOr(Schema.String),
  attribution: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(500)))),
  forkedFromVersionId: Schema.optional(Schema.String.pipe(Schema.maxLength(80))),
  /** Portable authored definitions only. Private attempts, drafts and evidence remain in Workspace. */
  activities: Schema.optional(Schema.Array(LearningActivitySchema).pipe(Schema.maxItems(500))),
}).pipe(
  Schema.filter(
    (area) =>
      area.activities === undefined ||
      (area.activities.every((activity) => activity.areaId === area.id) &&
        new Set(area.activities.map((activity) => activity.id)).size === area.activities.length),
  ),
);

/** The first portable Knowledge Area shape, before language, AI policy, and card metadata. */
const KnowledgeAreaV0_9Schema = Schema.Struct({
  schemaVersion: Schema.Literal("0.9.0"),
  id: AreaIdSchema,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  description: Schema.NullOr(Schema.String),
  objectives: Schema.Array(KnowledgeObjectiveSchema).pipe(Schema.maxItems(200)),
  cards: Schema.Array(
    Schema.Struct({
      id: AssessmentIdSchema,
      noteId: Schema.optional(Schema.String),
      templateId: Schema.optional(Schema.String),
      front: Schema.String.pipe(Schema.minLength(1)),
      back: Schema.String.pipe(Schema.minLength(1)),
      objectiveIds: Schema.Array(ObjectiveIdSchema),
    }),
  ).pipe(Schema.maxItems(500)),
});

export type KnowledgeArea = typeof KnowledgeAreaSchema.Type;
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
