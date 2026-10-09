import { ReviewTimestampSchema } from "./review-timestamp";
export { ReviewTimestampSchema, normalizeReviewTimestamp } from "./review-timestamp";
import { Effect, Either, Schema } from "effect";
export { AuthSessionResponseSchema } from "./auth-session";
export type { AuthSessionResponse } from "./auth-session";
export { HttpOperationSchema, HttpTelemetryEventSchema } from "./http-telemetry";
export type { HttpOperation, HttpTelemetryEvent } from "./http-telemetry";

export {
  AccountExportResponseSchema,
  DeleteAccountRequestSchema,
  DeleteAccountResponseSchema,
} from "./account";
export type { AccountExportResponse, DeleteAccountRequest, DeleteAccountResponse } from "./account";

export {
  PublishingErrorCodeSchema,
  PublishingErrorResponseSchema,
  ForkPublishedKnowledgeAreaRequestSchema,
  ForkPublishedKnowledgeAreaResponseSchema,
  PublicationVersionIdSchema,
  PublicationForkOperationIdSchema,
  PublicationVisibilitySchema,
  PublishedShareTokenSchema,
  PublishedKnowledgeAreaRowSchema,
  PublishKnowledgeAreaRequestSchema,
  PublishKnowledgeAreaResponseSchema,
  ReadPublishedKnowledgeAreaResponseSchema,
  ReadPublishedKnowledgeAreaRequestSchema,
  CheckPublicationUpdatesRequestSchema,
  CheckPublicationUpdatesResponseSchema,
  RotatePublishedShareTokenRequestSchema,
  RotatePublishedShareTokenResponseSchema,
} from "./publishing";
export type { CheckPublicationUpdatesRequest, CheckPublicationUpdatesResponse } from "./publishing";
export {
  MediaReferenceRouteRequestSchema,
  PublishedMediaReadRequestSchema,
  PublishedMediaRouteRequestSchema,
  PublishedShareTokenQuerySchema,
  PublishedMediaUploadResponseSchema,
} from "./publishing-media";
export type {
  MediaReferenceRouteRequest,
  PublishedMediaReadRequest,
  PublishedMediaRouteRequest,
  PublishedMediaUploadResponse,
} from "./publishing-media";
export {
  WorkspaceCardTombstoneSchema,
  WorkspaceAreaTombstoneRequestSchema,
  WorkspaceContentPushAreaSchema,
  WorkspaceContentPushRequestSchema,
  WorkspaceContentPushResponseSchema,
  WorkspaceSnapshotSchema,
} from "./workspace-content";
export type {
  WorkspaceCardTombstone,
  WorkspaceAreaTombstoneRequest,
  WorkspaceContentPushArea,
  WorkspaceContentPushRequest,
  WorkspaceContentPushResponse,
  WorkspaceSnapshot,
} from "./workspace-content";
export type {
  ForkPublishedKnowledgeAreaRequest,
  ForkPublishedKnowledgeAreaResponse,
  PublishKnowledgeAreaRequest,
  PublishKnowledgeAreaResponse,
  ReadPublishedKnowledgeAreaResponse,
  ReadPublishedKnowledgeAreaRequest,
  RotatePublishedShareTokenRequest,
  RotatePublishedShareTokenResponse,
} from "./publishing";
export type {
  PublishingErrorCode,
  PublishingErrorResponse,
  PublishedKnowledgeAreaRow,
} from "./publishing";

const UuidSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);
export const ReviewEventIdSchema = UuidSchema.pipe(Schema.brand("ReviewEventId"));
export const AssessmentIdSchema = UuidSchema.pipe(Schema.brand("AssessmentId"));
export const AreaIdSchema = UuidSchema.pipe(Schema.brand("AreaId"));
export const DeviceIdSchema = UuidSchema.pipe(Schema.brand("DeviceId"));
export const AreaTombstonesSchema = Schema.Array(
  Schema.Struct({
    areaId: AreaIdSchema,
    baseContentHash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/i)),
  }),
);
export const DeletedAreaIdsSchema = Schema.Array(AreaIdSchema);
const TimestampSchema = ReviewTimestampSchema;
const ReviewRatingSchema = Schema.Union(
  Schema.Literal("again"),
  Schema.Literal("hard"),
  Schema.Literal("good"),
  Schema.Literal("easy"),
);

export const SyncReviewOperationSchema = Schema.Struct({
  id: ReviewEventIdSchema,
  cardId: AssessmentIdSchema,
  deviceSequence: Schema.Number.pipe(Schema.int(), Schema.positive()),
  baseReviewEventId: Schema.NullOr(ReviewEventIdSchema),
  reviewedAtDevice: TimestampSchema,
  effectiveReviewedAt: TimestampSchema,
  rating: ReviewRatingSchema,
  elapsedMs: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  schedulerFamily: Schema.Literal("fsrs"),
  schedulerVersion: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  schedulerParameterSetId: Schema.NullOr(Schema.String.pipe(Schema.maxLength(80))),
  previousStateHash: Schema.NullOr(Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/i))),
});

export const SyncPushRequestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  deviceId: DeviceIdSchema,
  operations: Schema.Array(SyncReviewOperationSchema),
});

const SyncReviewPayloadSchema = Schema.Struct({
  id: ReviewEventIdSchema,
  areaId: AreaIdSchema,
  cardId: AssessmentIdSchema,
  ratedAt: TimestampSchema,
  rating: Schema.Union(
    Schema.Literal("again"),
    Schema.Literal("hard"),
    Schema.Literal("good"),
    Schema.Literal("easy"),
  ),
  schedulerFamily: Schema.Literal("fsrs"),
  schedulerVersion: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  deviceId: Schema.optional(DeviceIdSchema),
  deviceSequence: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  baseReviewEventId: Schema.optional(Schema.NullOr(ReviewEventIdSchema)),
  reviewedAtDevice: Schema.optional(TimestampSchema),
  effectiveReviewedAt: Schema.optional(TimestampSchema),
  elapsedMs: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.nonNegative()))),
  schedulerParameterSetId: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(80)))),
  previousStateHash: Schema.optional(
    Schema.NullOr(Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/i))),
  ),
});

export const SyncPushResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  acceptedIds: Schema.Array(ReviewEventIdSchema),
  acceptedReviewEvents: Schema.optional(
    Schema.Array(SyncReviewPayloadSchema).pipe(Schema.maxItems(100)),
  ),
  conflicts: Schema.Array(
    Schema.Struct({
      id: ReviewEventIdSchema,
      reason: Schema.Union(
        Schema.Literal("id-collision"),
        Schema.Literal("device-sequence-conflict"),
      ),
    }),
  ),
  cursor: Schema.String.pipe(Schema.pattern(/^\d+$/)),
});

export const SyncPullQuerySchema = Schema.Struct({
  cursor: Schema.String.pipe(Schema.pattern(/^\d{1,20}$/)),
});

const SyncPullQueryParametersSchema = Schema.Struct({
  cursor: Schema.optional(Schema.Array(Schema.String).pipe(Schema.maxItems(1))),
});

export const TutorSessionQuerySchema = Schema.Struct({
  sessionId: Schema.Array(UuidSchema).pipe(Schema.minItems(1), Schema.maxItems(1)),
});

const SyncChangeBaseSchema = {
  sequence: Schema.String.pipe(Schema.pattern(/^[1-9]\d{0,19}$/)),
  operationId: ReviewEventIdSchema,
  createdAt: TimestampSchema,
};

export const SyncChangeSchema = Schema.Union(
  Schema.Struct({
    ...SyncChangeBaseSchema,
    entityType: Schema.Literal("review_event"),
    entityId: ReviewEventIdSchema,
    operation: Schema.Literal("upsert"),
    payload: SyncReviewPayloadSchema,
  }),
  Schema.Struct({
    ...SyncChangeBaseSchema,
    entityType: Schema.Literal("card"),
    entityId: AssessmentIdSchema,
    operation: Schema.Literal("tombstone"),
    payload: Schema.Struct({
      id: AssessmentIdSchema,
      areaId: AreaIdSchema,
      deletedAt: TimestampSchema,
    }),
  }),
  Schema.Struct({
    ...SyncChangeBaseSchema,
    entityType: Schema.Literal("area"),
    entityId: AreaIdSchema,
    operation: Schema.Literal("tombstone"),
    payload: Schema.Struct({ id: AreaIdSchema, deletedAt: TimestampSchema }),
  }),
);

export const SyncPullResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  changes: Schema.Array(SyncChangeSchema).pipe(Schema.maxItems(100)),
  cursor: Schema.String.pipe(Schema.pattern(/^\d+$/)),
  hasMore: Schema.Boolean,
});

export type SyncReviewOperation = typeof SyncReviewOperationSchema.Type;
export type SyncPushRequest = typeof SyncPushRequestSchema.Type;
export type SyncPushResponse = typeof SyncPushResponseSchema.Type;
export type SyncPullQuery = typeof SyncPullQuerySchema.Type;
export type TutorSessionQuery = typeof TutorSessionQuerySchema.Type;
export type SyncChange = typeof SyncChangeSchema.Type;
export type SyncPullResponse = typeof SyncPullResponseSchema.Type;
export type AreaTombstone = (typeof AreaTombstonesSchema.Type)[number];
export type DeletedAreaIds = typeof DeletedAreaIdsSchema.Type;

export type SyncContractDecodeError = {
  readonly _tag: "SyncContractDecodeError";
  readonly reason: "invalid-shape" | "too-many-operations";
};

export function decodeSyncPushRequest(
  input: unknown,
): Effect.Effect<SyncPushRequest, SyncContractDecodeError> {
  const result = Schema.decodeUnknownEither(SyncPushRequestSchema)(input);
  if (Either.isLeft(result)) {
    return Effect.fail({ _tag: "SyncContractDecodeError", reason: "invalid-shape" });
  }
  if (result.right.operations.length > 100) {
    return Effect.fail({ _tag: "SyncContractDecodeError", reason: "too-many-operations" });
  }
  return Effect.succeed(result.right);
}

export function decodeSyncPullQuery(
  input: unknown,
): Effect.Effect<SyncPullQuery, SyncContractDecodeError> {
  const parameters = Schema.decodeUnknownEither(SyncPullQueryParametersSchema)(input);
  if (Either.isLeft(parameters)) {
    return Effect.fail({ _tag: "SyncContractDecodeError", reason: "invalid-shape" });
  }
  const result = Schema.decodeUnknownEither(SyncPullQuerySchema)({
    cursor: parameters.right.cursor?.[0] ?? "0",
  });
  return Either.isLeft(result)
    ? Effect.fail({ _tag: "SyncContractDecodeError", reason: "invalid-shape" })
    : Effect.succeed(result.right);
}

export * from "./tutor-privacy";
export * from "./workspace-review-identities";
export * from "./api-rate-limit";
