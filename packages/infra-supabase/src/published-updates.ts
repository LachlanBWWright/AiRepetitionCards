import { Effect, Either, Schema } from "effect";
import type { RecallSupabaseClient } from "./client";
import { readPublishedKnowledgeAreaVersion } from "./index";

const UuidSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);
const CurrentIdentitySchema = Schema.Struct({
  id: UuidSchema,
  source_area_id: Schema.NullOr(UuidSchema),
  version: Schema.Number.pipe(Schema.int(), Schema.positive()),
});
const OwnerSchema = Schema.Struct({ id: UuidSchema, owner_id: Schema.NullOr(UuidSchema) });
export type PublishedUpdatesReadFailure = {
  readonly _tag: "PublishedUpdatesReadFailure";
  readonly reason: "not-found" | "unavailable";
};
const failure = () => ({ _tag: "PublishedUpdatesReadFailure", reason: "unavailable" }) as const;
const notFound = () => ({ _tag: "PublishedUpdatesReadFailure", reason: "not-found" }) as const;

/** Resolve the exact existing capability, then discover only public versions by its publisher. */
export function readPublishedUpdates(
  client: RecallSupabaseClient,
  versionId: string,
  shareTokenHash: string | null,
) {
  return Effect.gen(function* () {
    const current = yield* readPublishedKnowledgeAreaVersion(
      client,
      versionId,
      shareTokenHash,
    ).pipe(Effect.mapError(failure));
    const identity = Schema.decodeUnknownEither(CurrentIdentitySchema)(current);
    if (Either.isLeft(identity) || identity.right.id.toLowerCase() !== versionId.toLowerCase())
      return yield* Effect.fail(notFound());
    if (identity.right.source_area_id === null) return { current, candidate: null };
    const sourceAreaId = identity.right.source_area_id;
    const ownerRow = yield* Effect.tryPromise({
      try: async (): Promise<
        { readonly _tag: "Read"; readonly row: unknown } | { readonly _tag: "Unavailable" }
      > => {
        if (shareTokenHash !== null) {
          const result = await client.rpc("read_unlisted_knowledge_area_version_for_media", {
            p_version_id: versionId,
            p_share_token_hash: shareTokenHash,
          });
          if (result.error !== null) return { _tag: "Unavailable" };
          const rows: unknown = result.data;
          return { _tag: "Read", row: Array.isArray(rows) ? (rows[0] as unknown) : null };
        }
        const result = await client
          .from("published_knowledge_area_versions")
          .select("id,owner_id")
          .eq("id", versionId)
          .eq("visibility", "public")
          .maybeSingle();
        return result.error === null ? { _tag: "Read", row: result.data } : { _tag: "Unavailable" };
      },
      catch: failure,
    });
    if (ownerRow._tag === "Unavailable") return yield* Effect.fail(failure());
    const owner = Schema.decodeUnknownEither(OwnerSchema)(ownerRow.row);
    if (Either.isLeft(owner) || owner.right.id.toLowerCase() !== versionId.toLowerCase())
      return yield* Effect.fail(notFound());
    if (owner.right.owner_id === null) return { current, candidate: null };
    const publisherId = owner.right.owner_id;
    const candidate = yield* Effect.tryPromise({
      try: () =>
        client
          .from("published_knowledge_area_versions")
          .select(
            "id,source_area_id,owner_id,version,content,content_hash,visibility,attribution,license,forked_from_version_id,created_at",
          )
          .eq("source_area_id", sourceAreaId)
          .eq("owner_id", publisherId)
          .eq("visibility", "public")
          .gt("version", identity.right.version)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
      catch: failure,
    });
    if (candidate.error !== null) return yield* Effect.fail(failure());
    return { current, candidate: candidate.data, publisherId };
  });
}
