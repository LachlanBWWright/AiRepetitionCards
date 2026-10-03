import { Effect } from "effect";
import type { RecallSupabaseClient } from "./client";

export type WorkspaceMediaStorageError = { readonly _tag: "WorkspaceMediaStorageError" };

/** Store validated media under a path scoped to its authenticated owner. */
export function uploadWorkspaceMedia(
  client: RecallSupabaseClient,
  ownerId: string,
  mediaId: string,
  mimeType: string,
  bytes: Uint8Array,
): Effect.Effect<"Created" | "AlreadyExists", WorkspaceMediaStorageError> {
  return Effect.tryPromise({
    try: async () => {
      const result = await client.storage
        .from("published-media")
        .upload(`${ownerId}/${mediaId}`, bytes, { contentType: mimeType, upsert: false });
      if (result.error?.statusCode === "409") return "AlreadyExists" as const;
      if (result.error !== null) return "Failure" as const;
      return "Created" as const;
    },
    catch: () => ({ _tag: "WorkspaceMediaStorageError" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result === "Failure"
        ? Effect.fail({ _tag: "WorkspaceMediaStorageError" } as const)
        : Effect.succeed(result),
    ),
  );
}

/** Download media only from the authenticated owner's object path. */
export function downloadWorkspaceMedia(
  client: RecallSupabaseClient,
  ownerId: string,
  mediaId: string,
): Effect.Effect<Uint8Array, WorkspaceMediaStorageError> {
  return Effect.tryPromise({
    try: async () => {
      const result = await client.storage.from("published-media").download(`${ownerId}/${mediaId}`);
      if (result.error !== null) return { _tag: "Failure" } as const;
      const bytes = await result.data.arrayBuffer();
      return { _tag: "Success", bytes: new Uint8Array(bytes) } as const;
    },
    catch: () => ({ _tag: "WorkspaceMediaStorageError" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === "Failure"
        ? Effect.fail({ _tag: "WorkspaceMediaStorageError" } as const)
        : Effect.succeed(result.bytes),
    ),
  );
}
