import { normalizeReviewTimestamp } from "./review-timestamp";
import { Schema } from "effect";

export const HttpOperationSchema = Schema.Literal(
  "auth-session-read",
  "account-export",
  "account-delete",
  "publication-create",
  "publication-read",
  "publication-updates-read",
  "publication-fork",
  "publication-token",
  "publication-media-read",
  "publication-media-write",
  "workspace-read",
  "workspace-review-identities",
  "workspace-write",
  "workspace-area-delete",
  "workspace-media-read",
  "workspace-media-write",
  "review-push",
  "review-pull",
  "tutor-privacy-read",
  "tutor-privacy-delete",
  "tutor-retention",
  "tutor-read",
  "tutor-action",
  "tutor-proposal-resolve",
  "openai-sign-in-start",
  "openai-sign-in-callback",
  "openai-sign-in-capabilities",
);
export type HttpOperation = typeof HttpOperationSchema.Type;

/** Operational metadata only: never include identity, content, credentials, URLs or causes. */
export const HttpTelemetryEventSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  requestId: Schema.String.pipe(Schema.pattern(/^[0-9a-f-]{36}$/i)),
  operation: HttpOperationSchema,
  status: Schema.Number.pipe(Schema.int(), Schema.between(100, 599)),
  durationMs: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  timestamp: Schema.String.pipe(
    Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    Schema.filter((value) => normalizeReviewTimestamp(value) !== null),
  ),
  unexpectedFailure: Schema.Boolean,
});
export type HttpTelemetryEvent = typeof HttpTelemetryEventSchema.Type;
