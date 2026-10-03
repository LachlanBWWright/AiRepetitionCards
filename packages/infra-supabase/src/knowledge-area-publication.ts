import { Effect, Either, Schema } from "effect";
import type { RecallSupabaseClient } from "./client";
import type { Json } from "./database.types";

export type PublicationMediaRead =
  { readonly _tag: "Downloaded"; readonly bytes: Uint8Array } | { readonly _tag: "Missing" };

export type KnowledgeAreaPublicationError =
  | { readonly _tag: "KnowledgeAreaPublicationUnavailable" }
  | { readonly _tag: "KnowledgeAreaVersionConflict" }
  | { readonly _tag: "KnowledgeAreaPublicationSaveFailed" };

export type KnowledgeAreaPublicationResult =
  | { readonly _tag: "Published"; readonly row: unknown }
  | { readonly _tag: "AreaNotFound" }
  | { readonly _tag: "SourceVersionNotFound" };

/** Owner-only recovery includes capability hash, which must never enter public responses. */
export function readPublicationOperation(
  client: RecallSupabaseClient,
  ownerId: string,
  versionId: string,
) {
  return Effect.tryPromise({
    try: () =>
      client
        .from("published_knowledge_area_versions")
        .select(
          "id,source_area_id,owner_id,version,content,content_hash,visibility,attribution,license,forked_from_version_id,created_at,share_token_hash",
        )
        .eq("id", versionId)
        .eq("owner_id", ownerId)
        .maybeSingle(),
    catch: () => ({ _tag: "KnowledgeAreaPublicationUnavailable" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      result.error !== null
        ? Effect.fail({ _tag: "KnowledgeAreaPublicationUnavailable" } as const)
        : Effect.succeed(result.data),
    ),
  );
}

/** Download a private media object belonging to the authenticated publisher. */
export function readPublicationMedia(
  client: RecallSupabaseClient,
  ownerId: string,
  mediaId: string,
): Effect.Effect<PublicationMediaRead, KnowledgeAreaPublicationError> {
  return Effect.tryPromise({
    try: async () => {
      const result = await client.storage.from("published-media").download(`${ownerId}/${mediaId}`);
      if (result.error !== null) return { _tag: "Missing" } as const;
      return {
        _tag: "Downloaded",
        bytes: new Uint8Array(await result.data.arrayBuffer()),
      } as const;
    },
    catch: () => ({ _tag: "KnowledgeAreaPublicationUnavailable" }) as const,
  });
}

/** Save a validated publication after checking ownership and any fork source. */
export function publishKnowledgeArea(
  client: RecallSupabaseClient,
  input: {
    readonly id: string;
    readonly sourceAreaId: string;
    readonly ownerId: string;
    readonly content: NonNullable<Json>;
    readonly contentHash: string;
    readonly visibility: "private" | "public" | "unlisted";
    readonly attribution: string | null;
    readonly license: string | null;
    readonly forkedFromVersionId: string | null;
    readonly shareTokenHash: string | null;
  },
): Effect.Effect<KnowledgeAreaPublicationResult, KnowledgeAreaPublicationError> {
  return Effect.tryPromise({
    try: async (): Promise<KnowledgeAreaPublicationResult | KnowledgeAreaPublicationError> => {
      const owned = await client
        .from("knowledge_areas")
        .select("id")
        .eq("id", input.sourceAreaId)
        .eq("owner_id", input.ownerId)
        .is("deleted_at", null)
        .maybeSingle();
      if (owned.error !== null) return { _tag: "KnowledgeAreaPublicationUnavailable" };
      if (owned.data === null) return { _tag: "AreaNotFound" };

      if (input.forkedFromVersionId !== null) {
        // The owned fork's immutable initial snapshot proves retained lineage,
        // including unlisted parents whose share capability has since expired.
        const initial = await client
          .from("knowledge_area_versions")
          .select("content")
          .eq("knowledge_area_id", input.sourceAreaId)
          .eq("created_by", input.ownerId)
          .order("version", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (initial.error !== null) return { _tag: "KnowledgeAreaPublicationUnavailable" };
        const lineage = Schema.decodeUnknownEither(
          Schema.Struct({
            forkedFromVersionId: Schema.String,
          }),
        )(initial.data?.content);
        const inherited =
          Either.isRight(lineage) &&
          lineage.right.forkedFromVersionId.toLowerCase() ===
            input.forkedFromVersionId.toLowerCase();
        if (!inherited) {
          const parent = await client
            .from("published_knowledge_area_versions")
            .select("id")
            .eq("id", input.forkedFromVersionId)
            .maybeSingle();
          if (parent.error !== null) return { _tag: "KnowledgeAreaPublicationUnavailable" };
          if (parent.data === null) return { _tag: "SourceVersionNotFound" };
        }
      }

      const latest = await client
        .from("published_knowledge_area_versions")
        .select("version")
        .eq("source_area_id", input.sourceAreaId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest.error !== null) return { _tag: "KnowledgeAreaPublicationUnavailable" };
      const version = (typeof latest.data?.version === "number" ? latest.data.version : 0) + 1;
      const inserted = await client
        .from("published_knowledge_area_versions")
        .insert({
          id: input.id,
          source_area_id: input.sourceAreaId,
          owner_id: input.ownerId,
          version,
          content: input.content,
          content_hash: input.contentHash,
          visibility: input.visibility,
          attribution: input.attribution,
          license: input.license,
          forked_from_version_id: input.forkedFromVersionId,
          share_token_hash: input.shareTokenHash,
          created_by: input.ownerId,
        })
        .select(
          "id, source_area_id, version, content, content_hash, visibility, attribution, license, forked_from_version_id, created_at",
        )
        .single();
      if (inserted.error !== null) {
        return inserted.error.code === "23505"
          ? { _tag: "KnowledgeAreaVersionConflict" }
          : { _tag: "KnowledgeAreaPublicationSaveFailed" };
      }
      return { _tag: "Published", row: inserted.data };
    },
    catch: () => ({ _tag: "KnowledgeAreaPublicationUnavailable" }) as const,
  }).pipe(
    Effect.flatMap((result) =>
      "_tag" in result &&
      (result._tag === "KnowledgeAreaPublicationUnavailable" ||
        result._tag === "KnowledgeAreaVersionConflict" ||
        result._tag === "KnowledgeAreaPublicationSaveFailed")
        ? Effect.fail(result)
        : Effect.succeed(result),
    ),
  );
}
