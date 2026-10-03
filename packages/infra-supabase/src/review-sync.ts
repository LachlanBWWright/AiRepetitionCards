import { Effect } from "effect";
import type { RecallSupabaseClient } from "./client";
import type { Database } from "./database.types";

export type ReviewSyncRepositoryError = { readonly _tag: "ReviewSyncRepositoryError" };
export type ReviewSyncSaveResult = { readonly _tag: "Saved" } | { readonly _tag: "UniqueConflict" };

/** Persist owner-scoped review events idempotently. Unique violations are reported separately. */
export function saveReviewEvents(
  client: RecallSupabaseClient,
  rows: readonly Database["public"]["Tables"]["review_events"]["Insert"][],
): Effect.Effect<ReviewSyncSaveResult, ReviewSyncRepositoryError> {
  const operation = Effect.tryPromise({
    try: async () => {
      if (rows.length === 0) return { _tag: "Saved" } as const;
      const result = await client
        .from("review_events")
        .upsert([...rows], { onConflict: "id", ignoreDuplicates: true });
      if (result.error?.code === "23505") return { _tag: "UniqueConflict" } as const;
      if (result.error !== null) return { _tag: "Failure" } as const;
      return { _tag: "Saved" } as const;
    },
    catch: () => ({ _tag: "ReviewSyncRepositoryError" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === "Failure"
        ? Effect.fail({ _tag: "ReviewSyncRepositoryError" } as const)
        : Effect.succeed(result),
    ),
  );
  return operation;
}

/** Read saved events by both authenticated owner and operation IDs. */
export function readReviewEventsByIds(
  client: RecallSupabaseClient,
  userId: string,
  ids: readonly string[],
): Effect.Effect<unknown, ReviewSyncRepositoryError> {
  if (ids.length === 0) return Effect.succeed([]);
  return Effect.tryPromise({
    try: async () => {
      const result = await client
        .from("review_events")
        .select(
          "id, card_id, device_id, device_sequence, base_review_event_id, reviewed_at_device, effective_reviewed_at, rating, elapsed_ms, scheduler_family, scheduler_version, scheduler_parameter_set_id, previous_state_hash",
        )
        .eq("user_id", userId)
        .in("id", [...ids]);
      if (result.error !== null) return { _tag: "Failure" } as const;
      return { _tag: "Success", rows: result.data } as const;
    },
    catch: () => ({ _tag: "ReviewSyncRepositoryError" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === "Failure"
        ? Effect.fail({ _tag: "ReviewSyncRepositoryError" } as const)
        : Effect.succeed(result.rows),
    ),
  );
}

/** Read the current owner-scoped change cursor. The caller validates the untrusted value. */
export function readReviewSyncCursor(
  client: RecallSupabaseClient,
  userId: string,
): Effect.Effect<unknown, ReviewSyncRepositoryError> {
  return Effect.tryPromise({
    try: async () => {
      const result = await client
        .from("sync_changes")
        .select("sequence")
        .eq("user_id", userId)
        .order("sequence", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (result.error !== null) return { _tag: "Failure" } as const;
      const value: unknown = result.data?.sequence;
      return { _tag: "Success", value } as const;
    },
    catch: () => ({ _tag: "ReviewSyncRepositoryError" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === "Failure"
        ? Effect.fail({ _tag: "ReviewSyncRepositoryError" } as const)
        : Effect.succeed(result.value),
    ),
  );
}

/** Read one bounded page of owner-scoped changes after the supplied cursor. */
export function readReviewSyncChanges(
  client: RecallSupabaseClient,
  userId: string,
  cursor: string,
): Effect.Effect<unknown, ReviewSyncRepositoryError> {
  return Effect.tryPromise({
    try: async () => {
      const result = await client
        .from("sync_changes")
        .select("sequence, operation_id, entity_type, entity_id, operation, payload, created_at")
        .eq("user_id", userId)
        .gt("sequence", cursor)
        .order("sequence", { ascending: true })
        .limit(101);
      if (result.error !== null) return { _tag: "Failure" } as const;
      const rows: unknown = result.data;
      return { _tag: "Success", rows } as const;
    },
    catch: () => ({ _tag: "ReviewSyncRepositoryError" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === "Failure"
        ? Effect.fail({ _tag: "ReviewSyncRepositoryError" } as const)
        : Effect.succeed(result.rows),
    ),
  );
}

/** Read card ownership metadata needed to enrich review changes, returning rows for route validation. */
export function readReviewSyncCards(
  client: RecallSupabaseClient,
  cardIds: readonly string[],
): Effect.Effect<unknown, ReviewSyncRepositoryError> {
  if (cardIds.length === 0) return Effect.succeed([]);
  return Effect.tryPromise({
    try: async () => {
      const result = await client
        .from("cards")
        .select("id, knowledge_area_id")
        .in("id", [...cardIds]);
      if (result.error !== null) return { _tag: "Failure" } as const;
      const rows: unknown = result.data;
      return { _tag: "Success", rows } as const;
    },
    catch: () => ({ _tag: "ReviewSyncRepositoryError" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === "Failure"
        ? Effect.fail({ _tag: "ReviewSyncRepositoryError" } as const)
        : Effect.succeed(result.rows),
    ),
  );
}
