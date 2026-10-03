import { deriveEffectiveReviewTime } from "@recall/sync-core";
import {
  supabaseApiAuthFailureStatus,
  type SupabaseApiContextErrorReason,
} from "@recall/infra-supabase";
import { observeRoute } from "@/lib/http/observe-route";
import { Effect, Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { privateJson } from "@/lib/http/private-json";
import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
import { ReviewEventSchema } from "@recall/domain";
import {
  AreaIdSchema,
  CardIdSchema,
  DeviceIdSchema,
  ReviewEventIdSchema,
  SyncReviewOperationSchema,
  SyncPullResponseSchema,
  SyncPushResponseSchema,
  decodeSyncPullQuery,
  decodeSyncPushRequest,
  ReviewTimestampSchema,
  normalizeReviewTimestamp,
} from "@recall/contracts";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { readJsonBody } from "@/lib/http/read-json";
import type { RecallSupabaseClient } from "@recall/infra-supabase";
import {
  readReviewEventsByIds,
  readReviewSyncCards,
  readReviewSyncChanges,
  readReviewSyncCursor,
  saveReviewEvents,
} from "@recall/infra-supabase/review-sync";

const StoredReviewEventSchema = Schema.Struct({
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
  card_id: CardIdSchema,
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
const StoredSyncChangeSchema = Schema.Union(
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
    entity_id: CardIdSchema,
    operation: Schema.Literal("tombstone"),
    payload: Schema.Struct({
      id: CardIdSchema,
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

function sequenceText(sequence: string | number): string | null {
  if (typeof sequence === "string") return /^[1-9]\d{0,19}$/.test(sequence) ? sequence : null;
  return Number.isSafeInteger(sequence) && sequence > 0 ? String(sequence) : null;
}

function contextFailure(reason: SupabaseApiContextErrorReason) {
  const status = supabaseApiAuthFailureStatus(reason);
  return privateJson({ error: reason }, { status });
}

async function currentCursor(client: RecallSupabaseClient, userId: string): Promise<string | null> {
  const result = await Effect.runPromise(Effect.either(readReviewSyncCursor(client, userId)));
  if (Either.isLeft(result)) return null;
  const sequence: unknown = result.right;
  if (typeof sequence === "string" && /^\d+$/.test(sequence)) return sequence;
  if (typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence >= 0) {
    return String(sequence);
  }
  return sequence === undefined ? "0" : null;
}

function sameReview(
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

async function handlePOST(request: NextRequest): Promise<NextResponse> {
  const context = await authenticateApiRequest(request);
  if (context._tag === "ContextError") return contextFailure(context.reason);
  const limited = await authenticatedApiRateLimit(context.userId, "review-sync", { request });
  if (limited) return limited;

  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 512_000)));
  if (Either.isLeft(body)) {
    const tooLarge = Either.isLeft(body) && body.left.reason === "too-large";
    return privateJson(
      { error: tooLarge ? "request-too-large" : "invalid-request" },
      { status: tooLarge ? 413 : 400 },
    );
  }
  const decoded = Effect.runSync(Effect.either(decodeSyncPushRequest(body.right)));
  if (Either.isLeft(decoded)) {
    const error =
      decoded.left.reason === "too-many-operations" ? "batch-too-large" : "invalid-request";
    return privateJson({ error }, { status: 400 });
  }

  const { client, userId } = context;
  const { deviceId, operations } = decoded.right;
  const serverReceivedAt = new Date().toISOString();
  const clockResults = operations.map((operation) =>
    Effect.runSync(
      Effect.either(deriveEffectiveReviewTime(operation.reviewedAtDevice, serverReceivedAt)),
    ),
  );
  if (clockResults.some(Either.isLeft))
    return privateJson({ error: "invalid-review-clock" }, { status: 400 });
  const effectiveTimes = new Map(
    operations.flatMap((operation, index) => {
      const clock = clockResults[index];
      return clock && Either.isRight(clock)
        ? [[operation.id, clock.right.effectiveReviewedAt] as const]
        : [];
    }),
  );
  const rows = operations.map((operation) => ({
    id: operation.id,
    user_id: userId,
    card_id: operation.cardId,
    device_id: deviceId,
    device_sequence: operation.deviceSequence,
    base_review_event_id: operation.baseReviewEventId,
    reviewed_at_device: operation.reviewedAtDevice,
    effective_reviewed_at: effectiveTimes.get(operation.id) ?? serverReceivedAt,
    rating: operation.rating,
    elapsed_ms: operation.elapsedMs,
    scheduler_family: operation.schedulerFamily,
    scheduler_version: operation.schedulerVersion,
    scheduler_parameter_set_id: operation.schedulerParameterSetId,
    previous_state_hash: operation.previousStateHash,
  }));

  if (rows.length > 0) {
    const save = await Effect.runPromise(Effect.either(saveReviewEvents(client, rows)));
    if (Either.isLeft(save)) {
      return privateJson({ error: "sync-write-failed" }, { status: 502 });
    }
    if (save.right._tag === "UniqueConflict") {
      const conflicts = operations.map((operation) => ({
        id: operation.id,
        reason: "device-sequence-conflict" as const,
      }));
      return privateJson(
        {
          schemaVersion: 1,
          acceptedIds: [],
          conflicts,
          cursor: (await currentCursor(client, userId)) ?? "0",
        },
        { status: 409 },
      );
    }
  }

  const ids = operations.map((operation) => operation.id);
  const storedQuery = await Effect.runPromise(
    Effect.either(readReviewEventsByIds(client, userId, ids)),
  );
  if (Either.isLeft(storedQuery)) {
    return privateJson({ error: "sync-read-failed" }, { status: 502 });
  }
  const storedRows: unknown = storedQuery.right;
  const validStoredRows = Schema.decodeUnknownEither(Schema.Array(StoredReviewEventSchema))(
    storedRows,
  );
  if (Either.isLeft(validStoredRows)) {
    return privateJson({ error: "sync-response-invalid" }, { status: 502 });
  }
  const byId = new Map(validStoredRows.right.map((row) => [row.id, row]));
  const acceptedIds: string[] = [];
  const conflicts: Array<{
    readonly id: string;
    readonly reason: "id-collision" | "device-sequence-conflict";
  }> = [];
  for (const operation of operations) {
    const stored = byId.get(operation.id);
    if (stored && sameReview(stored, { ...operation, deviceId })) {
      acceptedIds.push(operation.id);
    } else {
      conflicts.push({ id: operation.id, reason: "id-collision" });
    }
  }

  const cursor = await currentCursor(client, userId);
  if (cursor === null) return privateJson({ error: "sync-cursor-failed" }, { status: 502 });
  const acceptedCards = await Effect.runPromise(
    Effect.either(
      readReviewSyncCards(client, [
        ...new Set(
          acceptedIds.flatMap((id) => {
            const row = byId.get(id);
            return row ? [row.card_id] : [];
          }),
        ),
      ]),
    ),
  );
  if (Either.isLeft(acceptedCards))
    return privateJson({ error: "sync-read-failed" }, { status: 502 });
  const cardIdentities = Schema.decodeUnknownEither(
    Schema.Array(Schema.Struct({ id: CardIdSchema, knowledge_area_id: AreaIdSchema })),
  )(acceptedCards.right);
  if (Either.isLeft(cardIdentities))
    return privateJson({ error: "sync-response-invalid" }, { status: 502 });
  const areaIds = new Map<string, string>(
    cardIdentities.right.map((card) => [card.id, card.knowledge_area_id]),
  );
  const acceptedReviewEvents = acceptedIds.map((id) => {
    const row = byId.get(id);
    return row
      ? {
          id: row.id,
          areaId: areaIds.get(row.card_id),
          cardId: row.card_id,
          deviceId: row.device_id,
          deviceSequence: row.device_sequence,
          baseReviewEventId: row.base_review_event_id,
          reviewedAtDevice: row.reviewed_at_device,
          effectiveReviewedAt: normalizeReviewTimestamp(row.effective_reviewed_at),
          ratedAt: normalizeReviewTimestamp(row.effective_reviewed_at),
          rating: row.rating,
          elapsedMs: row.elapsed_ms,
          schedulerFamily: row.scheduler_family,
          schedulerVersion: row.scheduler_version,
          schedulerParameterSetId: row.scheduler_parameter_set_id,
          previousStateHash: row.previous_state_hash,
        }
      : null;
  });
  const response = Schema.decodeUnknownEither(SyncPushResponseSchema)({
    schemaVersion: 1,
    acceptedIds,
    acceptedReviewEvents,
    conflicts,
    cursor,
  });
  if (Either.isLeft(response)) {
    return privateJson({ error: "sync-response-invalid" }, { status: 502 });
  }
  return privateJson(response.right);
}

async function handleGET(request: NextRequest): Promise<NextResponse> {
  const context = await authenticateApiRequest(request);
  if (context._tag === "ContextError") return contextFailure(context.reason);
  const limited = await authenticatedApiRateLimit(context.userId, "review-sync", { request });
  if (limited) return limited;

  const query = new URL(request.url).searchParams;
  const decodedQuery = Effect.runSync(
    Effect.either(decodeSyncPullQuery({ cursor: query.getAll("cursor") })),
  );
  if (Either.isLeft(decodedQuery)) {
    return privateJson({ error: "invalid-cursor" }, { status: 400 });
  }

  const { client, userId } = context;
  const result = await Effect.runPromise(
    Effect.either(readReviewSyncChanges(client, userId, decodedQuery.right.cursor)),
  );
  if (Either.isLeft(result)) return privateJson({ error: "sync-read-failed" }, { status: 502 });

  const rawChanges: unknown = result.right;
  const changes = Schema.decodeUnknownEither(Schema.Array(StoredSyncChangeSchema))(rawChanges);
  if (Either.isLeft(changes)) {
    return privateJson({ error: "sync-response-invalid" }, { status: 502 });
  }

  const hasMore = changes.right.length > 100;
  const page = hasMore ? changes.right.slice(0, 100) : changes.right;
  const reviewCardIds = [
    ...new Set(
      page.flatMap((change) =>
        change.entity_type === "review_event" ? [change.payload.card_id] : [],
      ),
    ),
  ];
  const cardsResult = await Effect.runPromise(
    Effect.either(readReviewSyncCards(client, reviewCardIds)),
  );
  if (Either.isLeft(cardsResult))
    return privateJson({ error: "sync-read-failed" }, { status: 502 });
  const cardRows: unknown = cardsResult.right;
  const decodedCards = Schema.decodeUnknownEither(
    Schema.Array(Schema.Struct({ id: CardIdSchema, knowledge_area_id: AreaIdSchema })),
  )(cardRows);
  if (Either.isLeft(decodedCards)) {
    return privateJson({ error: "sync-response-invalid" }, { status: 502 });
  }
  const areaByCardId = new Map(decodedCards.right.map((row) => [row.id, row.knowledge_area_id]));
  let previousSequence = BigInt(decodedQuery.right.cursor);
  for (const change of changes.right) {
    const value = sequenceText(change.sequence);
    if (value === null || BigInt(value) <= previousSequence) {
      return privateJson({ error: "sync-response-invalid" }, { status: 502 });
    }
    previousSequence = BigInt(value);
  }
  const lastSequence = page.at(-1)?.sequence;
  const cursor =
    lastSequence === undefined ? decodedQuery.right.cursor : sequenceText(lastSequence);
  if (cursor === null) return privateJson({ error: "sync-cursor-invalid" }, { status: 502 });

  const responseChanges: unknown[] = [];
  for (const change of page) {
    const sequence = sequenceText(change.sequence);
    if (sequence === null) return privateJson({ error: "sync-response-invalid" }, { status: 502 });
    if (change.entity_type === "review_event") {
      const stored = change.payload;
      if (stored.id !== change.operation_id || stored.id !== change.entity_id) {
        return privateJson({ error: "sync-response-invalid" }, { status: 502 });
      }
      const areaId = areaByCardId.get(stored.card_id);
      if (areaId === undefined) {
        return privateJson({ error: "sync-response-invalid" }, { status: 502 });
      }
      const operation = Schema.decodeUnknownEither(SyncReviewOperationSchema)({
        id: stored.id,
        cardId: stored.card_id,
        deviceSequence: stored.device_sequence,
        baseReviewEventId: stored.base_review_event_id,
        reviewedAtDevice: stored.reviewed_at_device,
        effectiveReviewedAt: normalizeReviewTimestamp(stored.effective_reviewed_at),
        rating: stored.rating,
        elapsedMs: stored.elapsed_ms,
        schedulerFamily: stored.scheduler_family,
        schedulerVersion: stored.scheduler_version,
        schedulerParameterSetId: stored.scheduler_parameter_set_id,
        previousStateHash: stored.previous_state_hash,
      });
      if (Either.isLeft(operation)) {
        return privateJson({ error: "sync-response-invalid" }, { status: 502 });
      }
      const payload = Schema.decodeUnknownEither(ReviewEventSchema)({
        ...operation.right,
        areaId,
        ratedAt: operation.right.effectiveReviewedAt,
        deviceId: stored.device_id,
      });
      if (Either.isLeft(payload)) {
        return privateJson({ error: "sync-response-invalid" }, { status: 502 });
      }
      responseChanges.push({
        sequence,
        operationId: change.operation_id,
        entityType: change.entity_type,
        entityId: change.entity_id,
        operation: change.operation,
        payload: payload.right,
        createdAt: change.created_at,
      });
      continue;
    }
    if (change.payload.id !== change.entity_id) {
      return privateJson({ error: "sync-response-invalid" }, { status: 502 });
    }
    responseChanges.push({
      sequence,
      operationId: change.operation_id,
      entityType: change.entity_type,
      entityId: change.entity_id,
      operation: change.operation,
      payload: change.payload,
      createdAt: change.created_at,
    });
  }

  const response = Schema.decodeUnknownEither(SyncPullResponseSchema)({
    schemaVersion: 1,
    changes: responseChanges,
    cursor,
    hasMore,
  });
  if (Either.isLeft(response))
    return privateJson({ error: "sync-response-invalid" }, { status: 502 });
  return privateJson(response.right);
}

export const GET = observeRoute("review-pull", handleGET);

export const POST = observeRoute("review-push", handlePOST);
