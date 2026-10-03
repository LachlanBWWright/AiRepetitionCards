import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
import { supabaseApiAuthFailureStatus } from "@recall/infra-supabase";
import { observeRoute } from "@/lib/http/observe-route";
import { publishingErrorResponse } from "@/lib/publishing/error-response";
import { Effect, Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { privateJson } from "@/lib/http/private-json";
import { readBinaryBody } from "@/lib/http/read-binary-body";
import {
  MediaReferenceRouteRequestSchema,
  PublishedMediaUploadResponseSchema,
} from "@recall/contracts";
import { verifyMediaAsset } from "@recall/application";
import { uploadPublishedMedia } from "@recall/infra-supabase/published-media";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";

type RouteContext = { readonly params: Promise<{ readonly mediaId: string }> };
const maxMediaBytes = 20_000_000;

async function handlePOST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError") {
    const status = supabaseApiAuthFailureStatus(auth.reason);
    return publishingErrorResponse(auth.reason, status);
  }
  const limited = await authenticatedApiRateLimit(auth.userId, "review-sync", {
    request,
    namespace: "media-write",
    publication: true,
  });
  if (limited) return limited;
  const { mediaId } = await context.params;
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxMediaBytes) {
    return publishingErrorResponse("media-too-large", 413);
  }
  const rawReference = request.headers.get("x-recall-media-reference");
  const parsedReference = await Effect.runPromise(
    Effect.either(
      Effect.try({
        try: () => JSON.parse(rawReference ?? "null") as unknown,
        catch: () => ({ _tag: "ReferenceHeaderInvalid" }) as const,
      }),
    ),
  );
  if (Either.isLeft(parsedReference)) {
    return publishingErrorResponse("invalid-media-reference", 400);
  }
  const decodedReference = Schema.decodeUnknownEither(MediaReferenceRouteRequestSchema)({
    mediaId,
    reference: parsedReference.right,
  });
  if (
    Either.isLeft(decodedReference) ||
    decodedReference.right.reference.id !== decodedReference.right.mediaId
  ) {
    return publishingErrorResponse("invalid-media-reference", 400);
  }
  const body = await Effect.runPromise(Effect.either(readBinaryBody(request, maxMediaBytes)));
  if (Either.isLeft(body) && body.left.reason === "too-large") {
    return publishingErrorResponse("media-too-large", 413);
  }
  if (Either.isLeft(body) && body.left.reason === "unsupported-media-type") {
    return publishingErrorResponse("unsupported-media-type", 415);
  }
  if (Either.isLeft(body)) return publishingErrorResponse("media-read-failed", 400);
  const mediaBytes = body.right;
  const asset = { reference: decodedReference.right.reference, bytes: mediaBytes };
  if (!verifyMediaAsset(asset)) {
    return publishingErrorResponse("media-integrity-failed", 422);
  }

  const storageResult = await Effect.runPromise(
    Effect.either(
      uploadPublishedMedia(
        auth.client,
        auth.userId,
        decodedReference.right.mediaId,
        decodedReference.right.reference.mimeType,
        mediaBytes,
      ),
    ),
  );
  if (Either.isLeft(storageResult)) {
    return publishingErrorResponse("media-storage-unavailable", 502);
  }
  const response = Schema.decodeUnknownEither(PublishedMediaUploadResponseSchema)({
    schemaVersion: 1,
    reference: decodedReference.right.reference,
  });
  return Either.isLeft(response)
    ? publishingErrorResponse("media-response-invalid", 502)
    : privateJson(response.right, {
        status: storageResult.right === "AlreadyExists" ? 200 : 201,
      });
}

export const POST = observeRoute("publication-media-write", handlePOST);
