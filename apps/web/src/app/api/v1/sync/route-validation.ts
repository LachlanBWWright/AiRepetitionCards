import {
  AreaIdSchema,
  AssessmentIdSchema,
  DeviceIdSchema,
  ReviewEventIdSchema,
  ReviewTimestampSchema,
} from "@recall/contracts";
import { Schema } from "effect";

export const StoredReviewEventSchema = Schema.Struct({
  id: Schema.String,
  card_id: Schema.String,
  device_id: Schema.String,
  device_sequence: Schema.Number,
  base_review_event_id: Schema.NullOr(Schema.String),
  reviewed_at_device: Schema.String,
  effective_reviewed_at: Schema.String,
  rating: Schema.String,
  elapsed_ms: Schema.NullOr(Schema.Number),
  scheduler_family: Schema.String,
  scheduler_version: Schema.String,
  scheduler_parameter_set_id: Schema.NullOr(Schema.String),
  previous_state_hash: Schema.NullOr(Schema.String),
});

const StoredTimestampSchema = ReviewTimestampSchema;
const StoredSequenceSchema = Schema.Union(
  Schema.String.pipe(Schema.pattern(/^[1-9]\d{0,19}$/)),
  Schema.Number.pipe(
    Schema.int(),
    Schema.positive(),
    Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
);
const StoredSyncChangeCommon = {
  sequence: StoredSequenceSchema,
  operation_id: ReviewEventIdSchema,
  created_at: StoredTimestampSchema,
};
const StoredReviewEventPayloadSchema = Schema.Struct({
  id: ReviewEventIdSchema,
  card_id: AssessmentIdSchema,
  device_id: DeviceIdSchema,
  device_sequence: Schema.Number.pipe(Schema.int(), Schema.positive()),
  base_review_event_id: Schema.NullOr(ReviewEventIdSchema),
  reviewed_at_device: StoredTimestampSchema,
  effective_reviewed_at: StoredTimestampSchema,
  rating: Schema.Union(
    Schema.Literal("again"),
    Schema.Literal("hard"),
    Schema.Literal("good"),
    Schema.Literal("easy"),
  ),
  elapsed_ms: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  scheduler_family: Schema.Literal("fsrs"),
  scheduler_version: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  scheduler_parameter_set_id: Schema.NullOr(Schema.String.pipe(Schema.maxLength(80))),
  previous_state_hash: Schema.NullOr(Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/i))),
});

export const StoredSyncChangeSchema = Schema.Union(
  Schema.Struct({
    ...StoredSyncChangeCommon,
    entity_type: Schema.Literal("review_event"),
    entity_id: ReviewEventIdSchema,
    operation: Schema.Literal("upsert"),
    payload: StoredReviewEventPayloadSchema,
  }),
  Schema.Struct({
    ...StoredSyncChangeCommon,
    entity_type: Schema.Literal("card"),
    entity_id: AssessmentIdSchema,
    operation: Schema.Literal("tombstone"),
    payload: Schema.Struct({
      id: AssessmentIdSchema,
      areaId: AreaIdSchema,
      deletedAt: StoredTimestampSchema,
    }),
  }),
  Schema.Struct({
    ...StoredSyncChangeCommon,
    entity_type: Schema.Literal("area"),
    entity_id: AreaIdSchema,
    operation: Schema.Literal("tombstone"),
    payload: Schema.Struct({ id: AreaIdSchema, deletedAt: StoredTimestampSchema }),
  }),
);

export function sequenceText(sequence: string | number): string | null {
  if (typeof sequence === "string") return /^[1-9]\d{0,19}$/.test(sequence) ? sequence : null;
  return Number.isSafeInteger(sequence) && sequence > 0 ? String(sequence) : null;
}

export function sameReview(
  stored: typeof StoredReviewEventSchema.Type,
  operation: {
    readonly id: string;
    readonly cardId: string;
    readonly deviceId: string;
    readonly deviceSequence: number;
    readonly baseReviewEventId: string | null;
    readonly reviewedAtDevice: string;
    readonly effectiveReviewedAt: string;
    readonly rating: string;
    readonly elapsedMs: number | null;
    readonly schedulerFamily: string;
    readonly schedulerVersion: string;
    readonly schedulerParameterSetId: string | null;
    readonly previousStateHash: string | null;
  },
): boolean {
  const sameTimestamp = (left: string, right: string) => Date.parse(left) === Date.parse(right);
  return (
    stored.id === operation.id &&
    stored.card_id === operation.cardId &&
    stored.device_id === operation.deviceId &&
    stored.device_sequence === operation.deviceSequence &&
    stored.base_review_event_id === operation.baseReviewEventId &&
    sameTimestamp(stored.reviewed_at_device, operation.reviewedAtDevice) &&
    stored.rating === operation.rating &&
    stored.elapsed_ms === operation.elapsedMs &&
    stored.scheduler_family === operation.schedulerFamily &&
    stored.scheduler_version === operation.schedulerVersion &&
    stored.scheduler_parameter_set_id === operation.schedulerParameterSetId &&
    stored.previous_state_hash === operation.previousStateHash
  );
}
