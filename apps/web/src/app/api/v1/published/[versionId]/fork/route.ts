import { Effect, Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import {
  ForkPublishedKnowledgeAreaRequestSchema,
  ForkPublishedKnowledgeAreaResponseSchema,
} from "@recall/contracts";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { readJsonBody } from "@/lib/http/read-json";
import {
  contentHash,
  forkPortableArea,
  hashShareToken,
  parsePortableArea,
} from "@/lib/publishing/shared";

type RouteContext = { readonly params: Promise<{ readonly versionId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError") {
    const status =
      auth.reason === "not-configured" ? 503 : auth.reason === "unauthenticated" ? 401 : 502;
    return NextResponse.json({ error: auth.reason }, { status });
  }
  const { versionId } = await context.params;
  if (!UUID.test(versionId))
    return NextResponse.json({ error: "source-version-not-found" }, { status: 404 });
  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 4_096)));
  if (Either.isLeft(body)) {
    const tooLarge = body.left.reason === "too-large";
    return NextResponse.json(
      { error: tooLarge ? "request-too-large" : "invalid-request" },
      { status: tooLarge ? 413 : 400 },
    );
  }
  const requestBody = Schema.decodeUnknownEither(ForkPublishedKnowledgeAreaRequestSchema)(
    body.right,
  );
  if (Either.isLeft(requestBody)) {
    return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  }
  const shareToken = requestBody.right.shareToken ?? null;

  const { client } = auth;
  let raw: unknown = null;
  if (typeof shareToken === "string") {
    const result = await client.rpc("read_unlisted_knowledge_area_version", {
      p_version_id: versionId,
      p_share_token_hash: hashShareToken(shareToken),
    });
    if (!result.error && Array.isArray(result.data)) raw = result.data[0] ?? null;
  } else {
    const result = await client
      .from("published_knowledge_area_versions")
      .select("id, content, content_hash, attribution, license, created_at")
      .eq("id", versionId)
      .eq("visibility", "public")
      .maybeSingle();
    if (!result.error) raw = result.data;
  }
  if (typeof raw !== "object" || raw === null || !("content" in raw)) {
    return NextResponse.json({ error: "source-version-not-found" }, { status: 404 });
  }
  const source = raw as Record<string, unknown>;
  const sourceArea = parsePortableArea(source.content);
  if (
    sourceArea === null ||
    typeof source.content_hash !== "string" ||
    contentHash(sourceArea) !== source.content_hash
  ) {
    return NextResponse.json({ error: "source-version-invalid" }, { status: 502 });
  }
  const document = forkPortableArea(sourceArea);
  if (document === null)
    return NextResponse.json({ error: "fork-generation-failed" }, { status: 502 });
  const attribution = typeof source.attribution === "string" ? source.attribution : null;
  const license = typeof source.license === "string" ? source.license : null;
  const response = Schema.decodeUnknownEither(ForkPublishedKnowledgeAreaResponseSchema)({
    document,
    attribution,
    license,
    forkedFromVersionId: versionId,
  });
  return Either.isLeft(response)
    ? NextResponse.json({ error: "fork-response-invalid" }, { status: 502 })
    : NextResponse.json(response.right, {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      });
}
