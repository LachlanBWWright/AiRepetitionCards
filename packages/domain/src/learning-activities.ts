import { ActivityJsonObjectSchema } from "./activities/json";
import {
  ActivityInteractionSchema,
  ActivityRuntimeProvenanceSchema,
} from "./activities/interaction";
export * from "./activities/json";
export * from "./activities/interactive";
export * from "./activities/coding";
export * from "./activities/interaction";
export * from "./activities/lua";
import { Schema } from "effect";

const id = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(200),
  Schema.filter((value) => value.trim().length > 0),
);
const positiveVersion = Schema.Number.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.filter(Number.isSafeInteger),
);
const text = Schema.String.pipe(Schema.maxLength(40_000));
const time = Schema.String.pipe(
  Schema.filter(
    (value) =>
      Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value,
  ),
);
const unit = Schema.Number.pipe(Schema.finite(), Schema.between(0, 1));
const payload = ActivityJsonObjectSchema;
export const LearningActivitySchema = Schema.Struct({
  id,
  sourceId: Schema.optional(id),
  areaId: id,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(300)),
  pluginId: id,
  pluginVersion: positiveVersion,
  revision: positiveVersion,
  objectiveIds: Schema.Array(id).pipe(
    Schema.minItems(1),
    Schema.maxItems(20),
    Schema.filter((values) => new Set(values).size === values.length),
  ),
  fallback: text,
  payload,
  archived: Schema.optional(Schema.Boolean),
});
export type LearningActivity = typeof LearningActivitySchema.Type;
export const UnderstandingEvidenceSchema = Schema.Struct({
  objectiveId: id,
  dimension: Schema.Literal("recall", "recognition", "reasoning", "application", "transfer"),
  score: unit,
  confidence: unit,
  assistance: Schema.Literal("none", "hint", "worked-example", "answer-revealed"),
  assessment: Schema.Literal("self", "deterministic", "ai", "human"),
  explanation: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(4000)),
});
export type UnderstandingEvidence = typeof UnderstandingEvidenceSchema.Type;
export const ActivityResponseSchema = Schema.Struct({
  interaction: Schema.optional(ActivityInteractionSchema),
  presentedPrompts: Schema.optional(
    Schema.Array(text.pipe(Schema.minLength(1))).pipe(Schema.minItems(1), Schema.maxItems(10)),
  ),
  answers: Schema.Array(text).pipe(Schema.maxItems(20)),
  selectedOptionIds: Schema.Array(id).pipe(Schema.maxItems(20)),
  selfScore: unit,
  assistance: Schema.Literal("none", "hint", "worked-example", "answer-revealed"),
});
export type ActivityResponse = typeof ActivityResponseSchema.Type;
export const ActivityResultSchema = Schema.Struct({
  evidence: Schema.Array(UnderstandingEvidenceSchema).pipe(
    Schema.minItems(1),
    Schema.maxItems(100),
  ),
  feedback: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(8000)),
  evaluatorId: id,
  evaluatorVersion: id,
  suggestedReviewRating: Schema.optional(Schema.Literal("again", "hard", "good", "easy")),
});
export type ActivityResult = typeof ActivityResultSchema.Type;
export const LearningAttemptSchema = Schema.Struct({
  runtime: Schema.optional(ActivityRuntimeProvenanceSchema),
  id,
  activity: LearningActivitySchema,
  response: ActivityResponseSchema,
  result: ActivityResultSchema,
  startedAt: time,
  submittedAt: time,
  acceptedAt: time,
}).pipe(
  Schema.filter(
    (attempt) =>
      Date.parse(attempt.startedAt) <= Date.parse(attempt.submittedAt) &&
      Date.parse(attempt.submittedAt) <= Date.parse(attempt.acceptedAt) &&
      attempt.result.evidence.every(
        (entry) =>
          attempt.activity.objectiveIds.includes(entry.objectiveId) &&
          entry.assistance === attempt.response.assistance,
      ) &&
      new Set(attempt.result.evidence.map((entry) => `${entry.objectiveId}:${entry.dimension}`))
        .size === attempt.result.evidence.length,
  ),
);
export type LearningAttempt = typeof LearningAttemptSchema.Type;
export const ActivityDraftSchema = Schema.Struct({
  id,
  activity: LearningActivitySchema,
  response: ActivityResponseSchema,
  stage: Schema.Number.pipe(Schema.int(), Schema.between(0, 9)),
  startedAt: time,
  updatedAt: time,
}).pipe(Schema.filter((draft) => Date.parse(draft.startedAt) <= Date.parse(draft.updatedAt)));
export type ActivityDraft = typeof ActivityDraftSchema.Type;
export const ActivityEditorDraftSchema = Schema.Struct({
  id,
  areaId: id,
  title: text,
  pluginId: id,
  objectiveId: id,
  fields: Schema.Record({
    key: Schema.String,
    value: Schema.String.pipe(Schema.maxLength(100_000)),
  }),
  editing: Schema.optional(LearningActivitySchema),
  updatedAt: time,
});
export type ActivityEditorDraft = typeof ActivityEditorDraftSchema.Type;
export const ActivityLibrarySchema = Schema.Struct({
  version: Schema.Literal(1),
  editorDrafts: Schema.optional(Schema.Array(ActivityEditorDraftSchema).pipe(Schema.maxItems(500))),
  drafts: Schema.optional(Schema.Array(ActivityDraftSchema).pipe(Schema.maxItems(500))),
  activities: Schema.Array(LearningActivitySchema).pipe(Schema.maxItems(500)),
  attempts: Schema.Array(LearningAttemptSchema).pipe(Schema.maxItems(10_000)),
}).pipe(
  Schema.filter(
    (library) =>
      new Set(library.activities.map((activity) => activity.id)).size ===
        library.activities.length &&
      new Set(library.attempts.map((attempt) => attempt.id)).size === library.attempts.length &&
      new Set((library.drafts ?? []).map((draft) => draft.id)).size ===
        (library.drafts ?? []).length &&
      new Set((library.editorDrafts ?? []).map((draft) => draft.id)).size ===
        (library.editorDrafts ?? []).length &&
      JSON.stringify(library).length <= 5_000_000,
  ),
);
export type ActivityLibrary = typeof ActivityLibrarySchema.Type;
export const emptyActivityLibrary: ActivityLibrary = { version: 1, activities: [], attempts: [] };
