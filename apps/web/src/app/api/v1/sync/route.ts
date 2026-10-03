import { Effect, Either, Schema } from "effect";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  SyncPullResponseSchema,
  SyncPushResponseSchema,
  decodeSyncPullQuery,
  decodeSyncPushRequest,
} from "@recall/contracts";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { readJsonBody } from "@/lib/http/read-json";

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

const StoredSyncChangeSchema = Schema.Struct({
  sequence: Schema.Union(Schema.String, Schema.Number),
  operation_id: Schema.String,
  entity_type: Schema.String,
  entity_id: Schema.String,
  operation: Schema.String,
  payload: Schema.Unknown,
  created_at: Schema.String,
});

type SupabaseServerClient = SupabaseClient;

function contextFailure(reason: "not-configured" | "unauthenticated" | "unavailable") {
  const status = reason === "not-configured" ? 503 : reason === "unauthenticated" ? 401 : 502;
  return NextResponse.json({ error: reason }, { status });
}

async function currentCursor(client: SupabaseServerClient, userId: string): Promise<string | null> {
  const result = await client
    .from("sync_changes")
    .select("sequence")
    .eq("user_id", userId)
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) return null;
  const sequence: unknown = result.data?.sequence;
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
    sameTimestamp(stored.effective_reviewed_at, operation.effectiveReviewedAt) &&
    stored.rating === operation.rating &&
    stored.elapsed_ms === operation.elapsedMs &&
    stored.scheduler_family === operation.schedulerFamily &&
    stored.scheduler_version === operation.schedulerVersion &&
    stored.scheduler_parameter_set_id === operation.schedulerParameterSetId &&
    stored.previous_state_hash === operation.previousStateHash
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const context = await authenticateApiRequest(request);
  if (context._tag === "ContextError") return contextFailure(context.reason);

  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 512_000)));
  if (Either.isLeft(body)) {
    const tooLarge = Either.isLeft(body) && body.left.reason === "too-large";
    return NextResponse.json(
      { error: tooLarge ? "request-too-large" : "invalid-request" },
      { status: tooLarge ? 413 : 400 },
    );
  }
  const decoded = Effect.runSync(Effect.either(decodeSyncPushRequest(body.right)));
  if (Either.isLeft(decoded)) {
    const error =
      decoded.left.reason === "too-many-operations" ? "batch-too-large" : "invalid-request";
    return NextResponse.json({ error }, { status: 400 });
  }

  const { client, userId } = context;
  const { deviceId, operations } = decoded.right;
  const rows = operations.map((operation) => ({
    id: operation.id,
    user_id: userId,
    card_id: operation.cardId,
    device_id: deviceId,
    device_sequence: operation.deviceSequence,
    base_review_event_id: operation.baseReviewEventId,
    reviewed_at_device: operation.reviewedAtDevice,
    effective_reviewed_at: operation.effectiveReviewedAt,
    rating: operation.rating,
    elapsed_ms: operation.elapsedMs,
    scheduler_family: operation.schedulerFamily,
    scheduler_version: operation.schedulerVersion,
    scheduler_parameter_set_id: operation.schedulerParameterSetId,
    previous_state_hash: operation.previousStateHash,
  }));

  if (rows.length > 0) {
    const save = await client
      .from("review_events")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (save.error) {
      if (save.error.code === "23505") {
        const conflicts = operations.map((operation) => ({
          id: operation.id,
          reason: "device-sequence-conflict" as const,
        }));
        return NextResponse.json(
          {
            schemaVersion: 1,
            acceptedIds: [],
            conflicts,
            cursor: (await currentCursor(client, userId)) ?? "0",
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "sync-write-failed" }, { status: 502 });
    }
  }

  const ids = operations.map((operation) => operation.id);
  const storedQuery =
    ids.length === 0
      ? { data: [], error: null }
      : await client
          .from("review_events")
          .select(
            "id, card_id, device_id, device_sequence, base_review_event_id, reviewed_at_device, effective_reviewed_at, rating, elapsed_ms, scheduler_family, scheduler_version, scheduler_parameter_set_id, previous_state_hash",
          )
          .eq("user_id", userId)
          .in("id", ids);
  if (storedQuery.error) {
    return NextResponse.json({ error: "sync-read-failed" }, { status: 502 });
  }
  const storedRows: unknown = storedQuery.data;
  const validStoredRows = Schema.decodeUnknownEither(Schema.Array(StoredReviewEventSchema))(
    storedRows,
  );
  if (Either.isLeft(validStoredRows)) {
    return NextResponse.json({ error: "sync-response-invalid" }, { status: 502 });
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
  if (cursor === null) return NextResponse.json({ error: "sync-cursor-failed" }, { status: 502 });
  const response = Schema.decodeUnknownEither(SyncPushResponseSchema)({
    schemaVersion: 1,
    acceptedIds,
    conflicts,
    cursor,
  });
  if (Either.isLeft(response)) {
    return NextResponse.json({ error: "sync-response-invalid" }, { status: 502 });
  }
  return NextResponse.json(response.right);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const context = await authenticateApiRequest(request);
  if (context._tag === "ContextError") return contextFailure(context.reason);

  const rawCursor = new URL(request.url).searchParams.get("cursor") ?? "0";
  const decodedQuery = Effect.runSync(Effect.either(decodeSyncPullQuery({ cursor: rawCursor })));
  if (Either.isLeft(decodedQuery)) {
    return NextResponse.json({ error: "invalid-cursor" }, { status: 400 });
  }

  const { client, userId } = context;
  const result = await client
    .from("sync_changes")
    .select("sequence, operation_id, entity_type, entity_id, operation, payload, created_at")
    .eq("user_id", userId)
    .gt("sequence", decodedQuery.right.cursor)
    .order("sequence", { ascending: true })
    .limit(101);
  if (result.error) return NextResponse.json({ error: "sync-read-failed" }, { status: 502 });

  const rawChanges: unknown = result.data ?? [];
  const changes = Schema.decodeUnknownEither(Schema.Array(StoredSyncChangeSchema))(rawChanges);
  if (Either.isLeft(changes)) {
    return NextResponse.json({ error: "sync-response-invalid" }, { status: 502 });
  }

  const hasMore = changes.right.length > 100;
  const page = hasMore ? changes.right.slice(0, 100) : changes.right;
  const reviewCardIds = [
    ...new Set(
      page.flatMap((change) => {
        if (
          change.entity_type !== "review_event" ||
          typeof change.payload !== "object" ||
          change.payload === null
        )
          return [];
        const cardId = "card_id" in change.payload ? change.payload.card_id : null;
        return typeof cardId === "string" ? [cardId] : [];
      }),
    ),
  ];
  const cardsResult =
    reviewCardIds.length === 0
      ? { data: [], error: null }
      : await client.from("cards").select("id, knowledge_area_id").in("id", reviewCardIds);
  if (cardsResult.error) return NextResponse.json({ error: "sync-read-failed" }, { status: 502 });
  const areaByCardId = new Map(
    (cardsResult.data ?? []).map((row) => [row.id, row.knowledge_area_id]),
  );
  const lastSequence = page.at(-1)?.sequence;
  const cursor =
    lastSequence === undefined
      ? decodedQuery.right.cursor
      : typeof lastSequence === "string"
        ? lastSequence
        : Number.isSafeInteger(lastSequence) && lastSequence >= 0
          ? String(lastSequence)
          : null;
  if (cursor === null) return NextResponse.json({ error: "sync-cursor-invalid" }, { status: 502 });

  const response = Schema.decodeUnknownEither(SyncPullResponseSchema)({
    schemaVersion: 1,
    changes: page.map((change) => ({
      sequence: typeof change.sequence === "string" ? change.sequence : String(change.sequence),
      operationId: change.operation_id,
      entityType: change.entity_type,
      entityId: change.entity_id,
      operation: change.operation,
      payload:
        change.entity_type === "review_event" &&
        typeof change.payload === "object" &&
        change.payload !== null
          ? {
              id: change.operation_id,
              areaId:
                areaByCardId.get(
                  "card_id" in change.payload && typeof change.payload.card_id === "string"
                    ? change.payload.card_id
                    : "",
                ) ?? "",
              cardId: "card_id" in change.payload ? change.payload.card_id : "",
              ratedAt:
                "effective_reviewed_at" in change.payload
                  ? change.payload.effective_reviewed_at
                  : "",
              rating: "rating" in change.payload ? change.payload.rating : "",
              schedulerFamily:
                "scheduler_family" in change.payload ? change.payload.scheduler_family : "",
              schedulerVersion:
                "scheduler_version" in change.payload ? change.payload.scheduler_version : "",
              deviceId: "device_id" in change.payload ? change.payload.device_id : "",
              deviceSequence:
                "device_sequence" in change.payload ? change.payload.device_sequence : 0,
              baseReviewEventId:
                "base_review_event_id" in change.payload
                  ? change.payload.base_review_event_id
                  : null,
              reviewedAtDevice:
                "reviewed_at_device" in change.payload ? change.payload.reviewed_at_device : "",
              effectiveReviewedAt:
                "effective_reviewed_at" in change.payload
                  ? change.payload.effective_reviewed_at
                  : "",
              elapsedMs: "elapsed_ms" in change.payload ? change.payload.elapsed_ms : null,
              schedulerParameterSetId:
                "scheduler_parameter_set_id" in change.payload
                  ? change.payload.scheduler_parameter_set_id
                  : null,
              previousStateHash:
                "previous_state_hash" in change.payload ? change.payload.previous_state_hash : null,
            }
          : change.payload,
      createdAt: change.created_at,
    })),
    cursor,
    hasMore,
  });
  if (Either.isLeft(response))
    return NextResponse.json({ error: "sync-response-invalid" }, { status: 502 });
  return NextResponse.json(response.right);
}
