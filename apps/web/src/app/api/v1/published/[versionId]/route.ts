import { anonymousPublicationRateLimit } from "@/lib/http/api-rate-limit";
import { observeRoute } from "@/lib/http/observe-route";
import { publishingErrorResponse } from "@/lib/publishing/error-response";
import { Either, Effect, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@recall/infra-supabase/database.types";
import {
  PublicationVersionIdSchema,
  ReadPublishedKnowledgeAreaRequestSchema,
  ReadPublishedKnowledgeAreaResponseSchema,
  PublishedShareTokenQuerySchema,
  PublishedShareTokenSchema,
} from "@recall/contracts";
import { readPublishedKnowledgeAreaVersion } from "@recall/infra-supabase";
import { readSupabaseConfig } from "@/lib/supabase/config";
import {
  contentHash,
  hashShareToken,
  parsePortableArea,
  parsePublishedVersionRow,
} from "@/lib/publishing/shared";

type RouteContext = { readonly params: Promise<{ readonly versionId: string }> };
function unavailable(): NextResponse {
  return publishingErrorResponse("publication-not-found", 404);
}

async function handleGET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const limited = await anonymousPublicationRateLimit(request);
  if (limited) return limited;
  const { versionId } = await context.params;
  const decodedVersionId = Schema.decodeUnknownEither(PublicationVersionIdSchema)(versionId);
  if (Either.isLeft(decodedVersionId)) return unavailable();
  const tokenValues = request.nextUrl.searchParams.getAll("token");
  const decodedTokenQuery = Schema.decodeUnknownEither(PublishedShareTokenQuerySchema)({
    ...(tokenValues.length === 1 ? { token: tokenValues[0] } : {}),
    ...(tokenValues.length > 1 ? { token: tokenValues } : {}),
  });
  if (Either.isLeft(decodedTokenQuery)) return unavailable();
  const config = readSupabaseConfig();
  if (Either.isLeft(config)) return publishingErrorResponse("publication-unavailable", 503);
  const client = createClient<Database>(config.right.url, config.right.publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const authorizationToken = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const headerCapability =
    Schema.decodeUnknownEither(PublishedShareTokenSchema)(authorizationToken);
  const rawToken =
    decodedTokenQuery.right.token ??
    (Either.isRight(headerCapability) ? headerCapability.right : null);
  const decodedRequest = Schema.decodeUnknownEither(ReadPublishedKnowledgeAreaRequestSchema)({
    versionId: decodedVersionId.right,
    shareToken: rawToken,
  });
  if (Either.isLeft(decodedRequest)) return unavailable();
  const read = await Effect.runPromise(
    Effect.either(
      readPublishedKnowledgeAreaVersion(
        client,
        decodedRequest.right.versionId,
        decodedRequest.right.shareToken === null
          ? null
          : hashShareToken(decodedRequest.right.shareToken),
      ),
    ),
  );
  if (Either.isLeft(read)) return unavailable();
  const row = read.right;
  const publication = parsePublishedVersionRow(row);
  if (!publication) return unavailable();
  const content = parsePortableArea(publication.content);
  if (
    content === null ||
    publication.id !== decodedRequest.right.versionId ||
    publication.version === undefined ||
    publication.content_hash === undefined ||
    publication.created_at === undefined ||
    publication.attribution === undefined ||
    publication.license === undefined ||
    publication.forked_from_version_id === undefined
  )
    return unavailable();
  if (contentHash(content) !== publication.content_hash) return unavailable();
  const response = Schema.decodeUnknownEither(ReadPublishedKnowledgeAreaResponseSchema)({
    schemaVersion: 1,
    version: {
      id: publication.id,
      version: publication.version,
      content,
      contentHash: publication.content_hash,
      attribution: publication.attribution,
      license: publication.license,
      forkedFromVersionId: publication.forked_from_version_id,
      createdAt: publication.created_at,
    },
  });
  return Either.isLeft(response)
    ? unavailable()
    : NextResponse.json(response.right, {
        headers: {
          "Cache-Control": decodedRequest.right.shareToken
            ? "private, no-store"
            : "public, max-age=60",
        },
      });
}

export const GET = observeRoute("publication-read", handleGET);
