import { normalizeReviewTimestamp } from "./review-timestamp";
import * as Schema from "effect/Schema";

const DatabaseRowSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const DatabaseRowsSchema = Schema.Array(DatabaseRowSchema);

export const DeleteAccountRequestSchema = Schema.Struct({
  confirmation: Schema.Literal("DELETE"),
});

export const DeleteAccountResponseSchema = Schema.Struct({
  deleted: Schema.Literal(true),
});

export const AccountExportResponseSchema = Schema.Struct({
  format: Schema.Literal("recall-account-export"),
  version: Schema.Literal(1),
  exportedAt: Schema.String.pipe(
    Schema.maxLength(40),
    Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/),
    Schema.filter((value) => normalizeReviewTimestamp(value) !== null, {
      message: () => "Expected an ISO UTC export timestamp",
    }),
  ),
  account: Schema.Struct({
    userId: Schema.String.pipe(Schema.minLength(1)),
    profile: Schema.NullOr(DatabaseRowSchema),
  }),
  data: Schema.Struct({
    knowledgeAreas: DatabaseRowsSchema,
    knowledgeAreaVersions: DatabaseRowsSchema,
    learningObjectives: DatabaseRowsSchema,
    objectivePrerequisites: DatabaseRowsSchema,
    cards: DatabaseRowsSchema,
    cardRevisions: DatabaseRowsSchema,
    cardObjectives: DatabaseRowsSchema,
    reviewEvents: DatabaseRowsSchema,
    schedulingState: DatabaseRowsSchema,
    syncChanges: DatabaseRowsSchema,
    tutorSessions: DatabaseRowsSchema,
    tutorMessages: DatabaseRowsSchema,
    aiObservations: DatabaseRowsSchema,
    generatedCardProposals: DatabaseRowsSchema,
    aiUsage: DatabaseRowsSchema,
  }),
});

export type DeleteAccountRequest = typeof DeleteAccountRequestSchema.Type;
export type DeleteAccountResponse = typeof DeleteAccountResponseSchema.Type;
export type AccountExportResponse = typeof AccountExportResponseSchema.Type;
