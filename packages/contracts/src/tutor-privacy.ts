import * as Schema from "effect/Schema";

export const TutorPrivacyPolicySchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  retentionDays: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.between(1, 365))),
  deletionAvailable: Schema.Boolean,
});
export const DeleteTutorHistoryRequestSchema = Schema.Struct({
  confirmation: Schema.Literal("DELETE_TUTOR_HISTORY"),
});
export const DeleteTutorHistoryResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  deleted: Schema.Literal(true),
  deletedSessions: Schema.Number.pipe(Schema.int(), Schema.between(0, Number.MAX_SAFE_INTEGER)),
});
export const TutorRetentionResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  deletedSessions: Schema.Number.pipe(Schema.int(), Schema.between(0, 1_000)),
});
export type TutorPrivacyPolicy = typeof TutorPrivacyPolicySchema.Type;
export type DeleteTutorHistoryResponse = typeof DeleteTutorHistoryResponseSchema.Type;
