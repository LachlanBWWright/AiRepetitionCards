import { Effect } from "effect";
import type { RecallSupabaseClient } from "./client";
import type { Json } from "./database.types";
import { writeWorkspaceContent } from "./workspace-write";

export type PublishedForkSourceReadError = { readonly _tag: "PublishedForkSourceReadError" };
export type PublishedForkSource =
  { readonly _tag: "Found"; readonly row: unknown } | { readonly _tag: "Missing" };

/** Read a public version, or read an unlisted version with its pre-hashed share token. */
export function readPublishedForkSource(
  client: RecallSupabaseClient,
  versionId: string,
  shareTokenHash: string | null,
): Effect.Effect<PublishedForkSource, PublishedForkSourceReadError> {
  return Effect.tryPromise({
    try: async (): Promise<PublishedForkSource | PublishedForkSourceReadError> => {
      if (shareTokenHash !== null) {
        const result = await client.rpc("read_unlisted_knowledge_area_version", {
          p_version_id: versionId,
          p_share_token_hash: shareTokenHash,
        });
        if (result.error !== null) return { _tag: "PublishedForkSourceReadError" };
        const row = result.data[0] ?? null;
        return row === null ? { _tag: "Missing" } : { _tag: "Found", row };
      }

      const result = await client
        .from("published_knowledge_area_versions")
        .select("id, content, content_hash, attribution, license, created_at")
        .eq("id", versionId)
        .eq("visibility", "public")
        .maybeSingle();
      if (result.error !== null) return { _tag: "PublishedForkSourceReadError" };
      return result.data === null ? { _tag: "Missing" } : { _tag: "Found", row: result.data };
    },
    catch: () => ({ _tag: "PublishedForkSourceReadError" }) as const,
  }).pipe(
    Effect.flatMap((result) => {
      return result._tag === "PublishedForkSourceReadError"
        ? Effect.fail(result)
        : Effect.succeed(result);
    }),
  );
}

export type PublishedForkSaveError = { readonly _tag: "PublishedForkSaveError" };
export type PublishedForkSaveResult = "Saved" | "Conflict";

export type ExistingPublishedFork =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Deleted" }
  | { readonly _tag: "Found"; readonly row: unknown };

/** Recover only the initial immutable result owned by this authenticated user. */
export function readExistingPublishedFork(
  client: RecallSupabaseClient,
  ownerId: string,
  areaId: string,
  initialVersionId: string,
): Effect.Effect<ExistingPublishedFork, PublishedForkSaveError> {
  return Effect.tryPromise({
    try: async (): Promise<ExistingPublishedFork | PublishedForkSaveError> => {
      const area = await client
        .from("knowledge_areas")
        .select("id, owner_id, deleted_at")
        .eq("id", areaId)
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (area.error) return { _tag: "PublishedForkSaveError" };
      if (!area.data) return { _tag: "Missing" };
      if (area.data.deleted_at !== null) return { _tag: "Deleted" };
      const version = await client
        .from("knowledge_area_versions")
        .select("id, knowledge_area_id, content, content_hash, created_by")
        .eq("id", initialVersionId)
        .eq("knowledge_area_id", areaId)
        .eq("created_by", ownerId)
        .maybeSingle();
      if (version.error || !version.data) return { _tag: "PublishedForkSaveError" };
      return { _tag: "Found", row: version.data };
    },
    catch: () => ({ _tag: "PublishedForkSaveError" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === "PublishedForkSaveError" ? Effect.fail(result) : Effect.succeed(result),
    ),
  );
}

/** Atomically add a validated fork to the authenticated user's workspace. */
export function savePublishedFork(
  client: RecallSupabaseClient,
  ownerId: string,
  areaId: string,
  areas: Json,
  tombstones: Json,
): Effect.Effect<PublishedForkSaveResult, PublishedForkSaveError> {
  return writeWorkspaceContent(client, ownerId, [areaId], areas, tombstones).pipe(
    Effect.map((result) => (result._tag === "Synced" ? "Saved" : "Conflict")),
    Effect.mapError(() => ({ _tag: "PublishedForkSaveError" }) as const),
  );
}
