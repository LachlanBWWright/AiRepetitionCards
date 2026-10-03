import { Effect } from "effect";
import type { RecallSupabaseClient } from "./client";
import type { Json } from "./database.types";

export type WorkspaceContentWriteError = { readonly _tag: "WorkspaceContentWriteError" };
export type WorkspaceContentWriteResult =
  { readonly _tag: "Synced" } | { readonly _tag: "AreaDeleted" } | { readonly _tag: "Conflict" };

/** Check deletion state for this owner, then atomically sync validated content through the RPC. */
export function writeWorkspaceContent(
  client: RecallSupabaseClient,
  userId: string,
  areaIds: readonly string[],
  areas: Json,
  tombstones: Json,
): Effect.Effect<WorkspaceContentWriteResult, WorkspaceContentWriteError> {
  return Effect.tryPromise({
    try: async () => {
      if (areaIds.length > 0) {
        const deleted = await client
          .from("knowledge_areas")
          .select("id")
          .eq("owner_id", userId)
          .in("id", [...areaIds])
          .not("deleted_at", "is", null);
        if (deleted.error !== null) return { _tag: "Failure" } as const;
        if (deleted.data.length > 0) return { _tag: "AreaDeleted" } as const;
      }

      const saved = await client.rpc("sync_workspace_content", {
        p_areas: areas,
        p_tombstones: tombstones,
      });
      if (saved.error !== null) return { _tag: "Failure" } as const;
      return saved.data ? ({ _tag: "Synced" } as const) : ({ _tag: "Conflict" } as const);
    },
    catch: () => ({ _tag: "WorkspaceContentWriteError" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === "Failure"
        ? Effect.fail({ _tag: "WorkspaceContentWriteError" } as const)
        : Effect.succeed(result),
    ),
  );
}
