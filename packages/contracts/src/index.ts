import { Effect, Either, Schema } from "effect";

export {
  ForkPublishedKnowledgeAreaRequestSchema,
  ForkPublishedKnowledgeAreaResponseSchema,
  PublicationVersionIdSchema,
  PublicationVisibilitySchema,
  PublishKnowledgeAreaRequestSchema,
  PublishKnowledgeAreaResponseSchema,
  ReadPublishedKnowledgeAreaResponseSchema,
} from "./publishing";
export type {
  ForkPublishedKnowledgeAreaRequest,
  ForkPublishedKnowledgeAreaResponse,
  PublishKnowledgeAreaRequest,
  PublishKnowledgeAreaResponse,
  ReadPublishedKnowledgeAreaResponse,
} from "./publishing";

const UuidSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);
export const ReviewEventIdSchema = UuidSchema.pipe(Schema.brand("ReviewEventId"));
export const CardIdSchema = UuidSchema.pipe(Schema.brand("CardId"));
export const AreaIdSchema = UuidSchema.pipe(Schema.brand("AreaId"));
export const DeviceIdSchema = UuidSchema.pipe(Schema.brand("DeviceId"));
export const AreaTombstonesSchema = Schema.Array(
  Schema.Struct({
    areaId: AreaIdSchema,
    baseContentHash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/i)),
  }),
);
export const DeletedAreaIdsSchema = Schema.Array(AreaIdSchema);
const TimestampSchema = Schema.String.pipe(
  Schema.maxLength(40),
  Schema.pattern(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/),
);
const ReviewRatingSchema = Schema.Union(
  Schema.Literal("again"),
  Schema.Literal("hard"),
  Schema.Literal("good"),
  Schema.Literal("easy"),
);

export const SyncReviewOperationSchema = Schema.Struct({
  id: ReviewEventIdSchema,
  cardId: CardIdSchema,
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

export const SyncPushResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  acceptedIds: Schema.Array(ReviewEventIdSchema),
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

export const SyncChangeSchema = Schema.Struct({
  sequence: Schema.String.pipe(Schema.pattern(/^\d+$/)),
  operationId: ReviewEventIdSchema,
  entityType: Schema.Union(
    Schema.Literal("review_event"),
    Schema.Literal("card"),
    Schema.Literal("area"),
  ),
  entityId: Schema.Union(AreaIdSchema, CardIdSchema, ReviewEventIdSchema),
  operation: Schema.Union(Schema.Literal("upsert"), Schema.Literal("tombstone")),
  payload: Schema.Unknown,
  createdAt: TimestampSchema,
});

export const SyncPullResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  changes: Schema.Array(SyncChangeSchema),
  cursor: Schema.String.pipe(Schema.pattern(/^\d+$/)),
  hasMore: Schema.Boolean,
});

export type SyncReviewOperation = typeof SyncReviewOperationSchema.Type;
export type SyncPushRequest = typeof SyncPushRequestSchema.Type;
export type SyncPushResponse = typeof SyncPushResponseSchema.Type;
export type SyncPullQuery = typeof SyncPullQuerySchema.Type;
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
  const result = Schema.decodeUnknownEither(SyncPullQuerySchema)(input);
  return Either.isLeft(result)
    ? Effect.fail({ _tag: "SyncContractDecodeError", reason: "invalid-shape" })
    : Effect.succeed(result.right);
}
