import { randomUUID } from "node:crypto";
import { Effect, Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import {
  PublishKnowledgeAreaRequestSchema,
  PublishKnowledgeAreaResponseSchema,
} from "@recall/contracts";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { readJsonBody } from "@/lib/http/read-json";
import {
  contentHash,
  parsePortableArea,
  newShareToken,
  hashShareToken,
} from "@/lib/publishing/shared";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError") {
    const status =
      auth.reason === "not-configured" ? 503 : auth.reason === "unauthenticated" ? 401 : 502;
    return NextResponse.json({ error: auth.reason }, { status });
  }
  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 1_000_000)));
  if (Either.isLeft(body)) {
    const tooLarge = body.left.reason === "too-large";
    return NextResponse.json(
      { error: tooLarge ? "request-too-large" : "invalid-request" },
      { status: tooLarge ? 413 : 400 },
    );
  }
  const requestValue = Schema.decodeUnknownEither(PublishKnowledgeAreaRequestSchema)(body.right);
  if (Either.isLeft(requestValue)) {
    return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  }
  const { sourceAreaId, visibility } = requestValue.right;
  const attribution = requestValue.right.attribution ?? null;
  const license = requestValue.right.license ?? null;
  const forkedFromVersionId = requestValue.right.forkedFromVersionId ?? null;
  const area = parsePortableArea(requestValue.right.content);
  if (area === null || area.id !== sourceAreaId) {
    return NextResponse.json({ error: "invalid-publication" }, { status: 400 });
  }
  if (area.cards.some((card) => (card.media?.length ?? 0) > 0)) {
    return NextResponse.json({ error: "media-publishing-unavailable" }, { status: 422 });
  }
  if (area.cards.some((card) => card.kind !== "basic")) {
    return NextResponse.json({ error: "card-type-not-supported" }, { status: 422 });
  }

  const { client, userId } = auth;
  const owned = await client
    .from("knowledge_areas")
    .select("id")
    .eq("id", sourceAreaId)
    .eq("owner_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (owned.error) return NextResponse.json({ error: "publication-unavailable" }, { status: 502 });
  if (!owned.data) return NextResponse.json({ error: "area-not-found" }, { status: 404 });

  if (forkedFromVersionId !== null) {
    const parent = await client
      .from("published_knowledge_area_versions")
      .select("id")
      .eq("id", forkedFromVersionId)
      .maybeSingle();
    if (parent.error)
      return NextResponse.json({ error: "publication-unavailable" }, { status: 502 });
    if (!parent.data)
      return NextResponse.json({ error: "source-version-not-found" }, { status: 404 });
  }

  // The unique (source_area_id, version) constraint arbitrates concurrent publishers.
  const latest = await client
    .from("published_knowledge_area_versions")
    .select("version")
    .eq("source_area_id", sourceAreaId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) return NextResponse.json({ error: "publication-unavailable" }, { status: 502 });
  const version = (typeof latest.data?.version === "number" ? latest.data.version : 0) + 1;
  const token = visibility === "unlisted" ? newShareToken() : null;
  const row = {
    id: randomUUID(),
    source_area_id: sourceAreaId,
    owner_id: userId,
    version,
    content: area,
    content_hash: contentHash(area),
    visibility,
    attribution,
    license,
    forked_from_version_id: forkedFromVersionId,
    share_token_hash: token ? hashShareToken(token) : null,
    created_by: userId,
  };
  const inserted = await client
    .from("published_knowledge_area_versions")
    .insert(row)
    .select(
      "id, source_area_id, version, content, content_hash, visibility, attribution, license, forked_from_version_id, created_at",
    )
    .single();
  if (inserted.error) {
    const conflict = inserted.error.code === "23505";
    return NextResponse.json(
      { error: conflict ? "version-conflict" : "publication-save-failed" },
      { status: conflict ? 409 : 502 },
    );
  }
  const response = Schema.decodeUnknownEither(PublishKnowledgeAreaResponseSchema)({
    version: {
      id: inserted.data.id,
      sourceAreaId: inserted.data.source_area_id,
      version: inserted.data.version,
      content: area,
      contentHash: inserted.data.content_hash,
      visibility: inserted.data.visibility,
      attribution: inserted.data.attribution,
      license: inserted.data.license,
      forkedFromVersionId: inserted.data.forked_from_version_id,
      createdAt: inserted.data.created_at,
    },
    ...(token ? { shareToken: token } : {}),
  });
  return Either.isLeft(response)
    ? NextResponse.json({ error: "publication-response-invalid" }, { status: 502 })
    : NextResponse.json(response.right, { status: 201 });
}
