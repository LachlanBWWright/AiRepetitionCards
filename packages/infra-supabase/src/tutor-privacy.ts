import { Effect, Either, Schema } from "effect";
import type { RecallSupabaseClient } from "./client";

export type TutorPrivacyRepositoryFailure = { readonly _tag: "TutorPrivacyRepositoryFailure" };
const CountSchema = Schema.Number.pipe(Schema.int(), Schema.between(0, Number.MAX_SAFE_INTEGER));
const SessionRowsSchema = Schema.Array(
  Schema.Struct({
    id: Schema.UUID,
    user_id: Schema.UUID,
  }),
).pipe(Schema.maxItems(1_000));

function deleteCount(query: PromiseLike<{ readonly error: unknown; readonly count: unknown }>) {
  return Effect.tryPromise({
    try: async () => {
      const response = await query;
      const decoded = Schema.decodeUnknownEither(CountSchema)(response.count);
      return response.error !== null || Either.isLeft(decoded) ? null : decoded.right;
    },
    catch: (): TutorPrivacyRepositoryFailure => ({ _tag: "TutorPrivacyRepositoryFailure" }),
  }).pipe(
    Effect.flatMap((count) =>
      count === null
        ? Effect.fail({ _tag: "TutorPrivacyRepositoryFailure" } as const)
        : Effect.succeed(count),
    ),
  );
}

/** Only a service-role composition root may supply this client. Cascade removes tutor evidence,
 * messages and proposal records; independently approved cards and review events are preserved. */
export function deleteOwnedTutorHistory(client: RecallSupabaseClient, userId: unknown) {
  return Schema.decodeUnknown(Schema.UUID)(userId).pipe(
    Effect.mapError(() => ({ _tag: "TutorPrivacyRepositoryFailure" }) as const),
    Effect.flatMap((owner) =>
      deleteCount(client.from("tutor_sessions").delete({ count: "exact" }).eq("user_id", owner)),
    ),
  );
}

/** Expiry is measured since last session activity. Recheck expiry during deletion to avoid
 * removing a session renewed after selection. Each owner is explicit even with an admin client. */
export function purgeExpiredTutorHistory(
  client: RecallSupabaseClient,
  cutoff: unknown,
  batchSize: unknown,
): Effect.Effect<number, TutorPrivacyRepositoryFailure> {
  return Effect.gen(function* () {
    const input = yield* Schema.decodeUnknown(
      Schema.Struct({
        cutoff: Schema.String.pipe(Schema.filter((value) => Number.isFinite(Date.parse(value)))),
        batchSize: Schema.Number.pipe(Schema.int(), Schema.between(1, 1_000)),
      }),
    )({ cutoff, batchSize }).pipe(
      Effect.mapError(() => ({ _tag: "TutorPrivacyRepositoryFailure" }) as const),
    );
    const rows = yield* Effect.tryPromise({
      try: async () => {
        const result = await client
          .from("tutor_sessions")
          .select("id,user_id")
          .lt("updated_at", input.cutoff)
          .order("updated_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(input.batchSize);
        return result.error === null ? result.data : null;
      },
      catch: (): TutorPrivacyRepositoryFailure => ({ _tag: "TutorPrivacyRepositoryFailure" }),
    });
    const decoded = yield* Schema.decodeUnknown(SessionRowsSchema)(rows).pipe(
      Effect.mapError(() => ({ _tag: "TutorPrivacyRepositoryFailure" }) as const),
    );
    let deleted = 0;
    const owners = [...new Set(decoded.map((row) => row.user_id))];
    for (const owner of owners) {
      const ids = decoded.filter((row) => row.user_id === owner).map((row) => row.id);
      deleted += yield* deleteCount(
        client
          .from("tutor_sessions")
          .delete({ count: "exact" })
          .eq("user_id", owner)
          .in("id", ids)
          .lt("updated_at", input.cutoff),
      );
    }
    return deleted;
  });
}
