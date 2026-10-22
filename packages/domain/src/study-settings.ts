import { Schema } from "effect";
import { AssessmentIdSchema, AreaIdSchema, ReviewEventIdSchema } from "./ids";
import { ReviewerSettingsSchema } from "./reviewer-settings";

/** Private preferences, preserved in workspace backups and excluded from shared decks. */
export const SchedulerPolicySchema = Schema.Struct({
  requestRetention: Schema.Number.pipe(Schema.between(0.7, 0.97)),
  dailyNewLimit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(0, 1000))),
  dailyReviewLimit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(0, 10000))),
  pauseNewWhenOverdue: Schema.optional(Schema.Boolean),
  reviewOrder: Schema.optional(
    Schema.Literal("due", "retrievability", "interval-ascending", "interval-descending"),
  ),
  newReviewOrder: Schema.optional(Schema.Literal("after", "before", "mix")),
  learningSteps: Schema.optional(
    Schema.Array(Schema.Number.pipe(Schema.int(), Schema.between(1, 1440))).pipe(
      Schema.maxItems(5),
    ),
  ),
  relearningSteps: Schema.optional(
    Schema.Array(Schema.Number.pipe(Schema.int(), Schema.between(1, 1440))).pipe(
      Schema.maxItems(5),
    ),
  ),
  maximumInterval: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 36500))),
  easyDays: Schema.optional(
    Schema.Array(Schema.Number.pipe(Schema.int(), Schema.between(0, 6))).pipe(Schema.maxItems(7)),
  ),
  timeZone: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80))),
  burySiblings: Schema.optional(Schema.Boolean),
  buryNewSiblings: Schema.optional(Schema.Boolean),
  buryReviewSiblings: Schema.optional(Schema.Boolean),
  buryLearningSiblings: Schema.optional(Schema.Boolean),
  optimizationReviewedAfter: Schema.optional(
    Schema.String.pipe(
      Schema.pattern(/^\d{4}-.*Z$/),
      Schema.filter((value) => Number.isFinite(Date.parse(value))),
    ),
  ),
  rescheduleOnParameterChange: Schema.optional(Schema.Boolean),
  leechThreshold: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(2, 100))),
  weights: Schema.optional(
    Schema.Array(Schema.Number.pipe(Schema.finite(), Schema.between(0, 46.655))).pipe(
      Schema.itemsCount(21),
    ),
  ),
});
export type SchedulerPolicy = typeof SchedulerPolicySchema.Type;
export const SchedulerPresetSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  settings: SchedulerPolicySchema,
});
export const SavedCardSearchSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  query: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(500)),
});
export const FilteredDeckSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  query: Schema.String.pipe(Schema.maxLength(500)),
  limit: Schema.Number.pipe(Schema.int(), Schema.between(1, 500)),
  order: Schema.Literal("due", "weakest", "shortest", "longest"),
  mode: Schema.Literal("preview", "reschedule"),
  areaId: Schema.optional(AreaIdSchema),
});
export type FilteredDeck = typeof FilteredDeckSchema.Type;
export const SchedulerSettingsSchema = Schema.Struct({
  reviewer: Schema.optional(ReviewerSettingsSchema),
  areaReviewLimits: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Number.pipe(Schema.int(), Schema.between(0, 10000)),
    }),
  ),
  dailyLimitOverrides: Schema.optional(
    Schema.Array(
      Schema.Struct({
        areaId: Schema.optional(AreaIdSchema),
        startsAt: Schema.Number.pipe(Schema.finite()),
        endsAt: Schema.Number.pipe(Schema.finite()),
        dailyNewLimit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(0, 1000))),
        dailyReviewLimit: Schema.optional(
          Schema.Number.pipe(Schema.int(), Schema.between(0, 10000)),
        ),
      }),
    ).pipe(Schema.maxItems(100)),
  ),
  filteredDecks: Schema.optional(Schema.Array(FilteredDeckSchema).pipe(Schema.maxItems(100))),
  browserColumns: Schema.optional(
    Schema.Array(
      Schema.Literal("subject", "front", "back", "due", "interval", "lapses", "tags", "state"),
    ).pipe(Schema.minItems(1), Schema.maxItems(8)),
  ),
  ...SchedulerPolicySchema.fields,
  suspendedCardIds: Schema.optional(Schema.Array(AssessmentIdSchema)),
  presets: Schema.optional(Schema.Array(SchedulerPresetSchema).pipe(Schema.maxItems(100))),
  areaPresets: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  areaParents: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  newCardPositions: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Number.pipe(Schema.int(), Schema.between(0, 1_000_000)),
    }),
  ),
  savedSearches: Schema.optional(Schema.Array(SavedCardSearchSchema).pipe(Schema.maxItems(100))),
  activeStudyQuery: Schema.optional(Schema.String.pipe(Schema.maxLength(500))),
});
export type SchedulerSettings = typeof SchedulerSettingsSchema.Type;
export const ScheduleAdjustmentSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  areaId: AreaIdSchema,
  cardId: AssessmentIdSchema,
  afterReviewEventId: Schema.NullOr(ReviewEventIdSchema),
  recordedAt: Schema.String,
  kind: Schema.Literal("due", "reset"),
  due: Schema.String,
}).pipe(
  Schema.filter(
    (item) =>
      Number.isFinite(Date.parse(item.recordedAt)) &&
      Number.isFinite(Date.parse(item.due)) &&
      /Z$/.test(item.recordedAt) &&
      /Z$/.test(item.due),
  ),
);
export type ScheduleAdjustment = typeof ScheduleAdjustmentSchema.Type;
