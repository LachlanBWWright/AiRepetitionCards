import { Effect } from "effect";
import type { RecallSupabaseClient } from "../client";
import type { Json } from "../database.types";
export function workspaceStudyRequest(
  client: RecallSupabaseClient,
  input?: { readonly revision: number; readonly document: Json },
) {
  return Effect.tryPromise({
    try: () =>
      input
        ? client.rpc("sync_workspace_study", {
            p_revision: input.revision,
            p_document: input.document,
          })
        : client.rpc("read_workspace_study", {}),
    catch: () => ({ message: "Study settings storage is unavailable." }),
  }).pipe(
    Effect.flatMap((result) =>
      result.error
        ? Effect.fail({ message: "Study settings storage is unavailable." })
        : Effect.succeed(result.data),
    ),
  );
}

export function workspaceStudyPageRequest(
  client: RecallSupabaseClient,
  input: { readonly after: number } | { readonly revision: number; readonly document: Json },
) {
  return Effect.tryPromise({
    try: () =>
      "after" in input
        ? client.rpc("read_workspace_study_page", { p_after: input.after, p_limit: 5000 })
        : client.rpc("sync_workspace_study_batch", {
            p_revision: input.revision,
            p_document: input.document,
          }),
    catch: () => ({ message: "Study settings storage is unavailable." }),
  }).pipe(
    Effect.flatMap((result) =>
      result.error
        ? Effect.fail({ message: "Study settings storage is unavailable." })
        : Effect.succeed(result.data),
    ),
  );
}
