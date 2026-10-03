import { Effect, Schema } from "effect";
import type { RecallSupabaseClient } from "./client";

const CardsSchema = Schema.Array(
  Schema.Struct({
    id: Schema.UUID,
    knowledge_area_id: Schema.UUID,
    deleted_at: Schema.NullOr(Schema.String),
  }),
).pipe(Schema.maxItems(100));
const AreasSchema = Schema.Array(
  Schema.Struct({ id: Schema.UUID, deleted_at: Schema.NullOr(Schema.String) }),
).pipe(Schema.maxItems(100));
export type WorkspaceReviewIdentitiesUnavailable = {
  readonly _tag: "WorkspaceReviewIdentitiesUnavailable";
};
const unavailable = (): WorkspaceReviewIdentitiesUnavailable => ({
  _tag: "WorkspaceReviewIdentitiesUnavailable",
});

/** Owner-scoped identity metadata only, including archived cards and areas. */
export function readWorkspaceReviewIdentities(
  client: RecallSupabaseClient,
  userId: string,
  cardIds: readonly string[],
) {
  return Effect.gen(function* () {
    const ids = yield* Schema.decodeUnknown(
      Schema.Array(Schema.UUID).pipe(Schema.minItems(1), Schema.maxItems(100)),
    )(cardIds).pipe(Effect.mapError(unavailable));
    if (new Set(ids.map((id) => id.toLowerCase())).size !== ids.length)
      return yield* Effect.fail(unavailable());
    const result = yield* Effect.tryPromise({
      try: () =>
        client
          .from("cards")
          .select("id, knowledge_area_id, deleted_at")
          .in("id", [...ids])
          .limit(100),
      catch: unavailable,
    });
    if (result.error !== null) return yield* Effect.fail(unavailable());
    const cards = yield* Schema.decodeUnknown(CardsSchema)(result.data).pipe(
      Effect.mapError(unavailable),
    );
    if (cards.length === 0) return [];
    const areaResult = yield* Effect.tryPromise({
      try: () =>
        client
          .from("knowledge_areas")
          .select("id, deleted_at")
          .eq("owner_id", userId)
          .in("id", [...new Set(cards.map((card) => card.knowledge_area_id))])
          .limit(100),
      catch: unavailable,
    });
    if (areaResult.error !== null) return yield* Effect.fail(unavailable());
    const areas = yield* Schema.decodeUnknown(AreasSchema)(areaResult.data).pipe(
      Effect.mapError(unavailable),
    );
    const owned = new Map(areas.map((area) => [area.id, area]));
    return cards.flatMap((card) => {
      const area = owned.get(card.knowledge_area_id);
      return area
        ? [
            {
              id: card.id,
              areaId: card.knowledge_area_id,
              deleted: card.deleted_at !== null || area.deleted_at !== null,
            },
          ]
        : [];
    });
  });
}
