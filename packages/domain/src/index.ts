import {
  AssessmentScheduleSchema,
  ImportedScheduleSchema,
  ImportedScheduleBaselinesSchema,
  ReviewUndoStateSchema,
} from "./schedules";
export * from "./schedules";
import { NoteLibrarySchema } from "./notes";
export * from "./notes";
import { ReviewPresentationSchema } from "./review-presentation";
import { ImageOcclusionSchema } from "./image-occlusion";
import { ActivityLibrarySchema } from "./learning-activities";
import { SchedulerSettingsSchema } from "./study-settings";
import { ScheduleAdjustmentSchema } from "./study-settings";
export * from "./study-settings";
export * from "./effective-reviews";
export * from "./review-presentation";
export * from "./image-occlusion";
import { MediaReferenceSchema } from "./index-knowledge-area";
import { Effect, Either, Schema } from "effect";
import {
  AreaIdSchema,
  AssessmentIdSchema,
  DeviceIdSchema,
  ObjectiveIdSchema,
  ReviewEventIdSchema,
} from "./ids";

export * from "./ids";
export * from "./index-knowledge-area";

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

/** A scheduled learning exercise; the current representation supports flashcards and cloze. */
export const AssessmentSchema = Schema.Struct({
  importedSchedule: Schema.optional(ImportedScheduleSchema),
  presentation: Schema.optional(ReviewPresentationSchema),
  imageOcclusion: Schema.optional(ImageOcclusionSchema),
  id: AssessmentIdSchema,
  noteId: Schema.optional(Schema.String),
  templateId: Schema.optional(Schema.String),
  siblingId: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(20_100))),
  front: Schema.String.pipe(Schema.minLength(1)),
  back: Schema.String.pipe(Schema.minLength(1)),
  objective: Schema.String.pipe(Schema.minLength(1)),
  schedule: AssessmentScheduleSchema,
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
  cards: Schema.Array(AssessmentSchema),
  noteLibrary: Schema.optional(NoteLibrarySchema),
  objectives: Schema.optional(Schema.Array(LearningObjectiveSchema)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  language: Schema.optional(Schema.String),
  difficulty: Schema.optional(
    Schema.Union(
      Schema.Literal("beginner"),
      Schema.Literal("intermediate"),
      Schema.Literal("advanced"),
    ),
  ),
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

export const ReviewEventSchema = Schema.Struct({
  id: ReviewEventIdSchema,
  areaId: AreaIdSchema,
  cardId: AssessmentIdSchema,
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

const AccountUuidSchema = Schema.String.pipe(
  Schema.pattern(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/,
  ),
);
export const AccountIdSchema = Schema.transform(AccountUuidSchema, AccountUuidSchema, {
  strict: true,
  decode: (value) => value.toLowerCase(),
  encode: (value) => value.toLowerCase(),
});

function validRetainedReviewArea(
  area: typeof LearningAreaSchema.Type,
  active: ReadonlySet<string>,
  reviewEvents: readonly (typeof ReviewEventSchema.Type)[],
  deletedAreaIds: ReadonlySet<string>,
  deletedCardIds: ReadonlySet<string>,
): boolean {
  const objectives = new Set(area.objectives?.map((objective) => objective.id) ?? []);
  const validObjectives =
    objectives.size === (area.objectives ?? []).length &&
    (area.objectives?.every((objective) =>
      objective.prerequisiteIds.every((id) => objectives.has(id)),
    ) ??
      true);
  return (
    validObjectives &&
    area.cards.every(
      (card) =>
        !active.has(card.id) &&
        (card.objectiveIds ?? []).every((id) => objectives.has(id)) &&
        reviewEvents.some((event) => event.cardId === card.id) &&
        (deletedAreaIds.has(area.id) || deletedCardIds.has(`${area.id}:${card.id}`)),
    )
  );
}

/** Private append-only authored snapshots; never included in a shared KnowledgeArea. */
export const CardVersionSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  areaId: AreaIdSchema,
  cardId: AssessmentIdSchema,
  recordedAt: Schema.String.pipe(Schema.minLength(1)),
  reason: Schema.Literal("edit", "delete", "replace", "restore", "move"),
  movedToAreaId: Schema.optional(AreaIdSchema),
  card: AssessmentSchema,
  area: LearningAreaSchema,
}).pipe(
  Schema.filter(
    (version) =>
      (version.reason === "move"
        ? version.movedToAreaId !== undefined && version.movedToAreaId !== version.areaId
        : version.movedToAreaId === undefined) &&
      version.area.cards.length === 0 &&
      version.card.id === version.cardId &&
      version.area.id === version.areaId &&
      Number.isFinite(Date.parse(version.recordedAt)),
    {
      message: () =>
        "A card version must contain matching identities, an empty area card list and a valid timestamp.",
    },
  ),
);
export type CardVersion = typeof CardVersionSchema.Type;

export const ReviewCorrectionSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120)),
  eventId: ReviewEventIdSchema,
  recordedAt: Schema.String.pipe(
    Schema.pattern(/^\d{4}-.*Z$/),
    Schema.filter((value) => Number.isFinite(Date.parse(value))),
  ),
});
export const StudySyncDocumentSchema = Schema.Struct({
  importedSchedules: Schema.optional(ImportedScheduleBaselinesSchema),
  settings: SchedulerSettingsSchema,
  adjustments: Schema.Array(ScheduleAdjustmentSchema).pipe(Schema.maxItems(200000)),
  corrections: Schema.Array(ReviewCorrectionSchema).pipe(Schema.maxItems(200000)),
  undoStates: Schema.Array(ReviewUndoStateSchema).pipe(Schema.maxItems(200000)),
}).pipe(
  Schema.filter(
    (document) =>
      new Set(document.adjustments.map((item) => item.id)).size === document.adjustments.length &&
      new Set(document.corrections.map((item) => item.id)).size === document.corrections.length &&
      new Set(document.undoStates.map((item) => item.eventId)).size === document.undoStates.length,
  ),
);
export type StudySyncDocument = typeof StudySyncDocumentSchema.Type;
export const WorkspaceSchema = Schema.Struct({
  mediaTrash: Schema.optional(
    Schema.Array(Schema.Struct({ reference: MediaReferenceSchema, trashedAt: Schema.String })),
  ),
  importedScheduleBaselines: Schema.optional(ImportedScheduleBaselinesSchema),
  reviewCorrections: Schema.optional(Schema.Array(ReviewCorrectionSchema)),
  reviewUndoStates: Schema.optional(Schema.Array(ReviewUndoStateSchema)),
  syncStudyBaseline: Schema.optional(StudySyncDocumentSchema),
  studySettingsConflict: Schema.optional(
    Schema.Struct({ local: SchedulerSettingsSchema, remote: SchedulerSettingsSchema }),
  ),
  scheduleAdjustments: Schema.optional(Schema.Array(ScheduleAdjustmentSchema)),
  activityLibrary: Schema.optional(ActivityLibrarySchema),
  cardVersions: Schema.optional(Schema.Array(CardVersionSchema)),
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
    Schema.Array(Schema.Struct({ areaId: AreaIdSchema, cardId: AssessmentIdSchema })),
  ),
  deletedAreas: Schema.optional(
    Schema.Array(
      Schema.Struct({
        areaId: AreaIdSchema,
        baseContentHash: Schema.optional(Schema.String.pipe(Schema.pattern(/^[a-fA-F0-9]{64}$/))),
        synced: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
  syncContentFingerprints: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
    }),
  ),
  syncContentHashes: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String.pipe(Schema.pattern(/^[a-fA-F0-9]{64}$/)),
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
      const deletedAreaIds = new Set((workspace.deletedAreas ?? []).map((item) => item.areaId));
      const deletedCardIds = new Set(
        (workspace.deletedCards ?? []).map((item) => `${item.areaId}:${item.cardId}`),
      );
      return (
        new Set(retained.map((area) => area.id)).size === retained.length &&
        new Set(cardIds).size === cardIds.length &&
        retained.every((area) =>
          validRetainedReviewArea(
            area,
            active,
            workspace.reviewEvents ?? [],
            deletedAreaIds,
            deletedCardIds,
          ),
        )
      );
    },
    { message: () => "Retained deleted review content has invalid identities or references." },
  ),
);

export type Assessment = typeof AssessmentSchema.Type;
export type LearningArea = typeof LearningAreaSchema.Type;
export type ReviewEvent = typeof ReviewEventSchema.Type;
export type Workspace = typeof WorkspaceSchema.Type;
export type LegacyWorkspace = typeof LegacyWorkspaceSchema.Type;

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

export * from "./learning-activities";

export * from "./reviewer-settings";

export * from "./collection-capacity";

export { reviewPlacement, reviewEventsInArea } from "./review-placement";
