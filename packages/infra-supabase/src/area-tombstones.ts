import { Effect } from "effect";
import type { RecallSupabaseClient } from "./client";
import type { Json } from "./database.types";

export type TombstoneKnowledgeAreasError = {
  readonly _tag: "TombstoneKnowledgeAreasError";
};

export type TombstoneKnowledgeAreasResult =
  { readonly _tag: "Saved" } | { readonly _tag: "Conflict" };

/** Persist validated tombstones atomically through the owner-scoped database RPC. */
export function tombstoneKnowledgeAreas(
  client: RecallSupabaseClient,
  tombstones: Json,
): Effect.Effect<TombstoneKnowledgeAreasResult, TombstoneKnowledgeAreasError> {
  return Effect.tryPromise({
    try: async () => {
      const result = await client.rpc("tombstone_knowledge_areas", {
        p_area_tombstones: tombstones,
      });
      if (result.error !== null) return { _tag: "Failure" } as const;
      return result.data ? ({ _tag: "Saved" } as const) : ({ _tag: "Conflict" } as const);
    },
    catch: () => ({ _tag: "TombstoneKnowledgeAreasError" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === "Failure"
        ? Effect.fail({ _tag: "TombstoneKnowledgeAreasError" } as const)
        : Effect.succeed(result),
    ),
  );
}
