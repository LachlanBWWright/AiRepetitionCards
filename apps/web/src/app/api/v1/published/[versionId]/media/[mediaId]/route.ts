import { anonymousPublicationRateLimit } from "@/lib/http/api-rate-limit";
import { observeRoute } from "@/lib/http/observe-route";
import { publishingErrorResponse } from "@/lib/publishing/error-response";
import { Effect, Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { PublishedMediaRouteRequestSchema } from "@recall/contracts";
import { verifyMediaAsset } from "@recall/application";
import {
  downloadPublishedMedia,
  readPublishedMediaPublication,
} from "@recall/infra-supabase/published-media";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@recall/infra-supabase/database.types";
import { readSupabaseConfig } from "@/lib/supabase/config";
import {
  contentHash,
  hashShareToken,
  parsePortableArea,
  parsePublishedVersionRow,
} from "@/lib/publishing/shared";

type RouteContext = {
  readonly params: Promise<{ readonly versionId: string; readonly mediaId: string }>;
};
function notFound(): NextResponse {
  return publishingErrorResponse("published-media-not-found", 404);
}

async function handleGET(request: NextRequest, context: RouteContext): Promise<Response> {
  const limited = await anonymousPublicationRateLimit(request);
  if (limited) return limited;
  const { versionId, mediaId } = await context.params;
  const tokens = request.nextUrl.searchParams.getAll("token");
  const decodedRequest = Schema.decodeUnknownEither(PublishedMediaRouteRequestSchema)({
    versionId,
    mediaId,
    ...(tokens.length === 1 ? { token: tokens[0] } : {}),
    ...(tokens.length > 1 ? { token: tokens } : {}),
  });
  if (Either.isLeft(decodedRequest)) return notFound();
  const { token } = decodedRequest.right;
  const config = readSupabaseConfig();
  if (Either.isLeft(config)) {
    return publishingErrorResponse("media-unavailable", 503);
  }
  const client = createClient<Database>(config.right.url, config.right.publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });

  const lookup = await Effect.runPromise(
    Effect.either(
      readPublishedMediaPublication(
        client,
        versionId,
        token === undefined ? null : hashShareToken(token),
      ),
    ),
  );
  const raw = Either.isRight(lookup) ? lookup.right : null;
  const publication = parsePublishedVersionRow(raw);
  if (!publication || publication.content === undefined) return notFound();
  const area = parsePortableArea(publication.content);
  if (
    area === null ||
    publication.id !== versionId ||
    typeof publication.owner_id !== "string" ||
    publication.content_hash === undefined ||
    contentHash(area) !== publication.content_hash
  ) {
    return notFound();
  }
  const reference = area.cards
    .flatMap((card) => card.media ?? [])
    .find((item) => item.id === mediaId);
  if (!reference) return notFound();

  const headers: Record<string, string> = {
    "x-recall-publication-version-id": versionId,
  };
  if (token !== undefined) headers["x-recall-share-token-hash"] = hashShareToken(token);
  const mediaClient = createClient<Database>(config.right.url, config.right.publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers },
  });
  const downloadResult = await Effect.runPromise(
    Effect.either(downloadPublishedMedia(mediaClient, publication.owner_id, mediaId)),
  );
  if (Either.isLeft(downloadResult)) return notFound();
  const bytes = downloadResult.right;
  if (!verifyMediaAsset({ reference, bytes })) return notFound();
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": reference.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": token === undefined ? "public, max-age=300" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}

export const GET = observeRoute("publication-media-read", handleGET);
