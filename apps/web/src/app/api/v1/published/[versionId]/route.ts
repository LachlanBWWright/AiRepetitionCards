import { Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ReadPublishedKnowledgeAreaResponseSchema } from "@recall/contracts";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { contentHash, hashShareToken, parsePortableArea } from "@/lib/publishing/shared";

type RouteContext = { readonly params: Promise<{ readonly versionId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unavailable(): NextResponse {
  return NextResponse.json({ error: "publication-not-found" }, { status: 404 });
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { versionId } = await context.params;
  if (!UUID.test(versionId)) return unavailable();
  const config = readSupabaseConfig();
  if (Either.isLeft(config))
    return NextResponse.json({ error: "publication-unavailable" }, { status: 503 });
  const client = createClient(config.right.url, config.right.publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  let row: Record<string, unknown> | null = null;
  const rawToken =
    request.nextUrl.searchParams.get("token") ??
    request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ??
    null;
  if (rawToken !== null) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return unavailable();
    const result = await client.rpc("read_unlisted_knowledge_area_version", {
      p_version_id: versionId,
      p_share_token_hash: hashShareToken(rawToken),
    });
    if (result.error) return unavailable();
    const first: unknown = Array.isArray(result.data) ? result.data[0] : null;
    if (typeof first === "object" && first !== null) row = first as Record<string, unknown>;
  } else {
    const result = await client
      .from("published_knowledge_area_versions")
      .select(
        "id, source_area_id, version, content, content_hash, attribution, license, forked_from_version_id, created_at",
      )
      .eq("id", versionId)
      .eq("visibility", "public")
      .maybeSingle();
    if (result.error) return unavailable();
    if (result.data !== null) row = result.data as Record<string, unknown>;
  }
  if (!row) return unavailable();
  const content = parsePortableArea(row.content);
  if (
    content === null ||
    row.id !== versionId ||
    typeof row.version !== "number" ||
    typeof row.content_hash !== "string" ||
    typeof row.created_at !== "string" ||
    (row.attribution !== null && typeof row.attribution !== "string") ||
    (row.license !== null && typeof row.license !== "string") ||
    (row.forked_from_version_id !== null && typeof row.forked_from_version_id !== "string")
  )
    return unavailable();
  if (contentHash(content) !== row.content_hash) return unavailable();
  const response = Schema.decodeUnknownEither(ReadPublishedKnowledgeAreaResponseSchema)({
    version: {
      id: row.id,
      version: row.version,
      content,
      contentHash: row.content_hash,
      attribution: row.attribution,
      license: row.license,
      forkedFromVersionId: row.forked_from_version_id,
      createdAt: row.created_at,
    },
  });
  return Either.isLeft(response)
    ? unavailable()
    : NextResponse.json(response.right, {
        headers: { "Cache-Control": rawToken ? "private, no-store" : "public, max-age=60" },
      });
}
