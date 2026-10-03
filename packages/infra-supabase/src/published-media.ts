import { Effect, Either, Schema } from "effect";
import type { RecallSupabaseClient } from "./client";

export type PublishedMediaStorageError = { readonly _tag: "PublishedMediaStorageError" };
export type PublishedMediaPublicationError = { readonly _tag: "PublishedMediaPublicationError" };

/** Store content addressed media for an authenticated publication owner. */
export function uploadPublishedMedia(
  client: RecallSupabaseClient,
  ownerId: string,
  mediaId: string,
  mimeType: string,
  bytes: Uint8Array,
): Effect.Effect<"Created" | "AlreadyExists", PublishedMediaStorageError> {
  return Effect.tryPromise({
    try: async () => {
      const result = await client.storage
        .from("published-media")
        .upload(`${ownerId}/${mediaId}`, bytes, {
          contentType: mimeType,
          upsert: false,
        });
      if (result.error?.statusCode === "409") return "AlreadyExists" as const;
      if (result.error !== null) return "Failure" as const;
      return "Created" as const;
    },
    catch: () => ({ _tag: "PublishedMediaStorageError" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result === "Failure"
        ? Effect.fail({ _tag: "PublishedMediaStorageError" } as const)
        : Effect.succeed(result),
    ),
  );
}

/** Read a public version, or an unlisted version only when the supplied token hash matches. */
export function readPublishedMediaPublication(
  client: RecallSupabaseClient,
  versionId: string,
  shareTokenHash: string | null,
): Effect.Effect<unknown, PublishedMediaPublicationError> {
  return Effect.tryPromise({
    try: async () => {
      if (shareTokenHash !== null) {
        const result = await client.rpc("read_unlisted_knowledge_area_version_for_media", {
          p_version_id: versionId,
          p_share_token_hash: shareTokenHash,
        });
        if (result.error !== null) return { _tag: "Failure" } as const;
        const rows = Schema.decodeUnknownEither(Schema.Array(Schema.Unknown))(result.data);
        return {
          _tag: "Success",
          row: Either.isRight(rows) ? (rows.right[0] ?? null) : null,
        } as const;
      }
      const result = await client
        .from("published_knowledge_area_versions")
        .select("id, owner_id, content, content_hash, visibility")
        .eq("id", versionId)
        .eq("visibility", "public")
        .maybeSingle();
      if (result.error !== null) return { _tag: "Failure" } as const;
      const row: unknown = result.data;
      return { _tag: "Success", row } as const;
    },
    catch: () => ({ _tag: "PublishedMediaPublicationError" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === "Failure"
        ? Effect.fail({ _tag: "PublishedMediaPublicationError" } as const)
        : Effect.succeed(result.row),
    ),
  );
}

/** Download bytes from the publication owner's private media path. */
export function downloadPublishedMedia(
  client: RecallSupabaseClient,
  ownerId: string,
  mediaId: string,
): Effect.Effect<Uint8Array, PublishedMediaStorageError> {
  return Effect.tryPromise({
    try: async () => {
      const result = await client.storage.from("published-media").download(`${ownerId}/${mediaId}`);
      if (result.error !== null) return { _tag: "Failure" } as const;
      const bytes = await result.data.arrayBuffer();
      return { _tag: "Success", bytes: new Uint8Array(bytes) } as const;
    },
    catch: () => ({ _tag: "PublishedMediaStorageError" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === "Failure"
        ? Effect.fail({ _tag: "PublishedMediaStorageError" } as const)
        : Effect.succeed(result.bytes),
    ),
  );
}
