import { Schema } from "effect";
import { AreaIdSchema, AssessmentIdSchema, ReviewEventIdSchema } from "./ids";

/** Legacy cached schedules remain readable; private replay baselines use strict validation. */
export const AssessmentScheduleSchema = Schema.Struct({
  due: Schema.String,
  stability: Schema.Number,
  difficulty: Schema.Number,
  elapsed_days: Schema.Number,
  scheduled_days: Schema.Number,
  learning_steps: Schema.Number,
  reps: Schema.Number,
  lapses: Schema.Number,
  state: Schema.Literal(0, 1, 2, 3),
  last_review: Schema.optional(Schema.NullOr(Schema.String)),
});
export type AssessmentSchedule = typeof AssessmentScheduleSchema.Type;

function validUtcTimestamp(value: string): boolean {
  const at = Date.parse(value);
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value) &&
    Number.isFinite(at) &&
    new Date(at).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}
export const ReplayScheduleSchema = AssessmentScheduleSchema.pipe(
  Schema.filter(
    (schedule) =>
      validUtcTimestamp(schedule.due) &&
      (schedule.last_review === undefined ||
        schedule.last_review === null ||
        validUtcTimestamp(schedule.last_review)) &&
      [
        schedule.stability,
        schedule.difficulty,
        schedule.elapsed_days,
        schedule.scheduled_days,
        schedule.learning_steps,
        schedule.reps,
        schedule.lapses,
      ].every((value) => Number.isFinite(value) && value >= 0),
  ),
);
export const ImportedScheduleSchema = Schema.Struct({
  schedule: ReplayScheduleSchema,
  reviewEventIds: Schema.Array(ReviewEventIdSchema).pipe(
    Schema.maxItems(100000),
    Schema.filter((ids) => new Set(ids).size === ids.length),
  ),
});
export const ImportedScheduleBaselineSchema = Schema.Struct({
  areaId: AreaIdSchema,
  cardId: AssessmentIdSchema,
  baseline: ImportedScheduleSchema,
});
export const ImportedScheduleBaselinesSchema = Schema.Array(ImportedScheduleBaselineSchema).pipe(
  Schema.maxItems(50000),
  Schema.filter((items) => new Set(items.map((item) => item.cardId)).size === items.length),
);
export const ReviewUndoStateSchema = Schema.Struct({
  eventId: ReviewEventIdSchema,
  schedule: ReplayScheduleSchema,
});
