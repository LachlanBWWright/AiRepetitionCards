import { anonymousPublicationRateLimit } from "@/lib/http/api-rate-limit";
import { createClient } from "@supabase/supabase-js";
import { Effect, Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import {
  CheckPublicationUpdatesRequestSchema,
  CheckPublicationUpdatesResponseSchema,
  PublicationVersionIdSchema,
} from "@recall/contracts";
import type { Database } from "@recall/infra-supabase/database.types";
import { readPublishedUpdates } from "@recall/infra-supabase/published-updates";
import { observeRoute } from "@/lib/http/observe-route";
import { privateJson } from "@/lib/http/private-json";
import { publishingErrorResponse } from "@/lib/publishing/error-response";
import { readSupabaseConfig } from "@/lib/supabase/config";
import {
  contentHash,
  hashShareToken,
  parsePortableArea,
  parsePublishedVersionRow,
} from "@/lib/publishing/shared";

type RouteContext = { readonly params: Promise<{ readonly versionId: string }> };
const unavailable = () => publishingErrorResponse("publication-not-found", 404);

async function handleGET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const limited = await anonymousPublicationRateLimit(request);
  if (limited) return limited;
  const { versionId } = await context.params;
  const query = request.nextUrl.searchParams;
  for (const key of query.keys())
    if (!["sourceAreaId", "token"].includes(key) || query.getAll(key).length !== 1)
      return publishingErrorResponse("invalid-request", 400);
  const parsed = Schema.decodeUnknownEither(CheckPublicationUpdatesRequestSchema)({
    versionId,
    ...(query.has("sourceAreaId") ? { sourceAreaId: query.get("sourceAreaId") } : {}),
    ...(query.has("token") ? { shareToken: query.get("token") } : {}),
  });
  if (Either.isLeft(parsed)) return publishingErrorResponse("invalid-request", 400);
  const config = readSupabaseConfig();
  if (Either.isLeft(config)) return publishingErrorResponse("publication-unavailable", 503);
  const client = createClient<Database>(config.right.url, config.right.publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const read = await Effect.runPromise(
    Effect.either(
      readPublishedUpdates(
        client,
        parsed.right.versionId,
        parsed.right.shareToken ? hashShareToken(parsed.right.shareToken) : null,
      ),
    ),
  );
  if (Either.isLeft(read))
    return read.left.reason === "unavailable"
      ? publishingErrorResponse("publication-unavailable", 503)
      : unavailable();
  const known = parsePublishedVersionRow(read.right.current);
  const knownContent = known ? parsePortableArea(known.content) : null;
  if (
    !known ||
    !knownContent ||
    known.id !== parsed.right.versionId ||
    known.version === undefined ||
    known.content_hash === undefined ||
    contentHash(knownContent) !== known.content_hash
  )
    return unavailable();
  const sourceId = Schema.decodeUnknownEither(PublicationVersionIdSchema)(
    known.source_area_id ?? knownContent.id,
  );
  if (
    Either.isLeft(sourceId) ||
    knownContent.id.toLowerCase() !== sourceId.right ||
    (parsed.right.sourceAreaId !== undefined && parsed.right.sourceAreaId !== sourceId.right)
  )
    return unavailable();
  let latestPublicVersion: unknown = null;
  if (read.right.candidate !== null) {
    const candidate = parsePublishedVersionRow(read.right.candidate);
    const content = candidate ? parsePortableArea(candidate.content) : null;
    if (
      !candidate ||
      !content ||
      candidate.id === undefined ||
      candidate.id === known.id ||
      candidate.version === undefined ||
      candidate.version <= known.version ||
      candidate.visibility !== "public" ||
      candidate.source_area_id?.toLowerCase() !== sourceId.right ||
      content.id.toLowerCase() !== sourceId.right ||
      candidate.owner_id !== read.right.publisherId ||
      candidate.content_hash === undefined ||
      contentHash(content) !== candidate.content_hash ||
      candidate.created_at === undefined
    )
      return publishingErrorResponse("publication-response-invalid", 502);
    latestPublicVersion = {
      id: candidate.id,
      version: candidate.version,
      sourceAreaId: sourceId.right,
      createdAt: candidate.created_at,
    };
  }
  const response = Schema.decodeUnknownEither(CheckPublicationUpdatesResponseSchema)({
    schemaVersion: 1,
    knownVersion: { id: known.id, version: known.version, sourceAreaId: sourceId.right },
    latestPublicVersion,
  });
  return Either.isLeft(response)
    ? publishingErrorResponse("publication-response-invalid", 502)
    : privateJson(response.right);
}
export const GET = observeRoute("publication-updates-read", handleGET);
