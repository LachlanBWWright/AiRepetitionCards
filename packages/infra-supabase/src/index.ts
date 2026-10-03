import { createClient } from "@supabase/supabase-js";
import { Effect, Either, Schema } from "effect";
import type { Database } from "./database.types";
import type { RecallSupabaseClient } from "./client";

export type { Database } from "./database.types";
export type { RecallSupabaseClient } from "./client";

export type SupabaseApiConfiguration = {
  readonly url: string;
  readonly publishableKey: string;
};

export type SupabaseApiAuthResult =
  | {
      readonly _tag: "Authenticated";
      readonly client: RecallSupabaseClient;
      readonly userId: string;
    }
  | {
      readonly _tag: "ContextError";
      readonly reason: SupabaseApiContextErrorReason;
    };

export type SupabaseApiContextErrorReason =
  "not-configured" | "unauthenticated" | "unavailable" | "workspace-account-changed";

export function supabaseApiAuthFailureStatus(reason: SupabaseApiContextErrorReason): number {
  return reason === "not-configured"
    ? 503
    : reason === "unauthenticated"
      ? 401
      : reason === "workspace-account-changed"
        ? 409
        : 502;
}

export type PublishedVersionReadError = { readonly _tag: "SupabasePublishedVersionReadError" };

export type SupabaseWorkspaceSnapshotReadError = {
  readonly _tag: "SupabaseWorkspaceSnapshotReadError";
};

/** Read the owner-scoped rows used to assemble a workspace snapshot. */
export function readWorkspaceSnapshotRows(
  client: RecallSupabaseClient,
): Effect.Effect<
  { readonly areas: unknown; readonly deletedAreas: unknown; readonly versions: unknown },
  SupabaseWorkspaceSnapshotReadError
> {
  const operation = Effect.tryPromise({
    try: async () => {
      const areas = await client
        .from("knowledge_areas")
        .select("id, color")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });
      if (areas.error !== null) return { _tag: "ReadFailure" } as const;

      const deletedAreas = await client
        .from("knowledge_areas")
        .select("id")
        .not("deleted_at", "is", null);
      if (deletedAreas.error !== null) return { _tag: "ReadFailure" } as const;

      const areaRows: unknown = areas.data;
      const decodedAreas = Schema.decodeUnknownEither(
        Schema.Array(Schema.Struct({ id: Schema.String })),
      )(areaRows);
      const areaIds = Either.isRight(decodedAreas) ? decodedAreas.right.map((area) => area.id) : [];
      let versionRows: unknown = [];
      if (areaIds.length > 0) {
        const versions = await client
          .from("knowledge_area_versions")
          .select("knowledge_area_id, version, content, content_hash")
          .in("knowledge_area_id", areaIds)
          .order("version", { ascending: false });
        if (versions.error !== null) return { _tag: "ReadFailure" } as const;
        versionRows = versions.data;
      }
      return {
        _tag: "ReadSuccess",
        rows: {
          areas: areas.data,
          deletedAreas: deletedAreas.data,
          versions: versionRows,
        },
      } as const;
    },
    catch: () => ({ _tag: "SupabaseWorkspaceSnapshotReadError" }) as const,
  });
  return operation.pipe(
    Effect.flatMap((result) =>
      result._tag === "ReadSuccess"
        ? Effect.succeed(result.rows)
        : Effect.fail({ _tag: "SupabaseWorkspaceSnapshotReadError" } as const),
    ),
  );
}

/** Read either an explicitly unlisted version using its token hash or a public version. */
export function readPublishedKnowledgeAreaVersion(
  client: RecallSupabaseClient,
  versionId: string,
  shareTokenHash: string | null,
): Effect.Effect<unknown, PublishedVersionReadError> {
  const operation = Effect.tryPromise({
    try: async (): Promise<
      { readonly _tag: "ReadSuccess"; readonly data: unknown } | { readonly _tag: "ReadFailure" }
    > => {
      if (shareTokenHash !== null) {
        const result = await client.rpc("read_unlisted_knowledge_area_version", {
          p_version_id: versionId,
          p_share_token_hash: shareTokenHash,
        });
        if (result.error !== null) return { _tag: "ReadFailure" };
        const rows: unknown = result.data;
        if (!Array.isArray(rows)) return { _tag: "ReadSuccess", data: null };
        const first: unknown = rows[0];
        return {
          _tag: "ReadSuccess",
          data: typeof first === "object" && first !== null ? first : null,
        };
      }

      const result = await client
        .from("published_knowledge_area_versions")
        .select(
          "id, source_area_id, version, content, content_hash, attribution, license, forked_from_version_id, created_at",
        )
        .eq("id", versionId)
        .eq("visibility", "public")
        .maybeSingle();
      if (result.error !== null) return { _tag: "ReadFailure" };
      const row: unknown = result.data;
      return { _tag: "ReadSuccess", data: row };
    },
    catch: () => ({ _tag: "SupabasePublishedVersionReadError" }) as const,
  });
  return operation.pipe(
    Effect.flatMap((result) =>
      result._tag === "ReadSuccess"
        ? Effect.succeed(result.data)
        : Effect.fail({ _tag: "SupabasePublishedVersionReadError" } as const),
    ),
  );
}

/** Authenticate a bearer or cookie-backed API request without depending on a web framework. */
export async function authenticateSupabaseApiRequest(
  request: Request,
  configuration: SupabaseApiConfiguration | null,
  createCookieClient: (configuration: SupabaseApiConfiguration) => Promise<RecallSupabaseClient>,
): Promise<SupabaseApiAuthResult> {
  if (configuration === null) return { _tag: "ContextError", reason: "not-configured" };

  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (authorization && !bearer) return { _tag: "ContextError", reason: "unauthenticated" };
  const expectedOwner = request.headers.get("x-recall-workspace-owner");
  if (
    expectedOwner !== null &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      expectedOwner,
    )
  )
    return { _tag: "ContextError", reason: "workspace-account-changed" };

  const result = await Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: async () => {
          const client = bearer
            ? createClient<Database>(configuration.url, configuration.publishableKey, {
                auth: {
                  autoRefreshToken: false,
                  detectSessionInUrl: false,
                  persistSession: false,
                },
                global: { headers: { Authorization: `Bearer ${bearer}` } },
              })
            : await createCookieClient(configuration);
          const claims = await client.auth.getClaims(bearer);
          const subject = claims.data === null ? null : claims.data.claims.sub;
          return { client, userId: typeof subject === "string" ? subject : null };
        },
        catch: () => ({ _tag: "SupabaseApiAuthError" }) as const,
      }),
    ),
  );
  if (Either.isLeft(result)) return { _tag: "ContextError", reason: "unavailable" };
  if (!result.right.userId) return { _tag: "ContextError", reason: "unauthenticated" };
  if (expectedOwner !== null && expectedOwner.toLowerCase() !== result.right.userId.toLowerCase())
    return { _tag: "ContextError", reason: "workspace-account-changed" };
  return { _tag: "Authenticated", ...result.right, userId: result.right.userId };
}

export {
  readTutorObservationHistory,
  type TutorObservationHistoryReadError,
} from "./tutor-repository";
