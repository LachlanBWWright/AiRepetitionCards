import { Effect } from "effect";
import type { RecallSupabaseClient } from "./client";

export type PublishedShareTokenUpdate =
  { readonly _tag: "Updated" } | { readonly _tag: "PublicationNotFound" };

export type PublishedShareTokenUpdateError = {
  readonly _tag: "PublishedShareTokenUpdateUnavailable";
};

/** Update an unlisted publication's share-token hash through the typed RPC boundary. */
export function managePublishedShareToken(
  client: RecallSupabaseClient,
  input: {
    readonly versionId: string;
    readonly action: "rotate" | "revoke";
    readonly shareTokenHash: string | null;
  },
): Effect.Effect<PublishedShareTokenUpdate, PublishedShareTokenUpdateError> {
  return Effect.tryPromise({
    try: async () => {
      const result = await client.rpc("manage_unlisted_knowledge_area_share_token", {
        p_version_id: input.versionId,
        p_action: input.action,
        ...(input.shareTokenHash === null ? {} : { p_share_token_hash: input.shareTokenHash }),
      });
      if (result.error !== null) return { _tag: "Failure" } as const;
      return result.data
        ? ({ _tag: "Updated" } as const)
        : ({ _tag: "PublicationNotFound" } as const);
    },
    catch: () => ({ _tag: "PublishedShareTokenUpdateUnavailable" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === "Failure"
        ? Effect.fail({ _tag: "PublishedShareTokenUpdateUnavailable" } as const)
        : Effect.succeed(result),
    ),
  );
}
