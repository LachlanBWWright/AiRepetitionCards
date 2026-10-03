import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
import { supabaseApiAuthFailureStatus } from "@recall/infra-supabase";
import { observeRoute } from "@/lib/http/observe-route";
import { publishingErrorResponse } from "@/lib/publishing/error-response";
import { Effect, Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { privateJson } from "@/lib/http/private-json";
import {
  PublicationVersionIdSchema,
  RotatePublishedShareTokenRequestSchema,
  RotatePublishedShareTokenResponseSchema,
} from "@recall/contracts";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { readJsonBody } from "@/lib/http/read-json";
import { hashShareToken, newShareToken } from "@/lib/publishing/shared";
import { managePublishedShareToken } from "@recall/infra-supabase/publication-token";

type RouteContext = { readonly params: Promise<{ readonly versionId: string }> };

async function handlePATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError") {
    const status = supabaseApiAuthFailureStatus(auth.reason);
    return publishingErrorResponse(auth.reason, status);
  }

  const limited = await authenticatedApiRateLimit(auth.userId, "workspace-sync", {
    request,
    namespace: "publication-write",
    publication: true,
  });
  if (limited) return limited;
  const { versionId } = await context.params;
  const parsedVersionId = Schema.decodeUnknownEither(PublicationVersionIdSchema)(versionId);
  if (Either.isLeft(parsedVersionId)) return publishingErrorResponse("publication-not-found", 404);

  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 4_096)));
  if (Either.isLeft(body)) {
    const tooLarge = body.left.reason === "too-large";
    return publishingErrorResponse(
      tooLarge ? "request-too-large" : "invalid-request",
      tooLarge ? 413 : 400,
    );
  }
  const requestBody = Schema.decodeUnknownEither(RotatePublishedShareTokenRequestSchema)(
    body.right,
  );
  if (Either.isLeft(requestBody)) return publishingErrorResponse("invalid-request", 400);

  const token = requestBody.right.action === "rotate" ? newShareToken() : null;
  const result = await Effect.runPromise(
    Effect.either(
      managePublishedShareToken(auth.client, {
        versionId: parsedVersionId.right,
        action: requestBody.right.action,
        shareTokenHash: token === null ? null : hashShareToken(token),
      }),
    ),
  );
  if (Either.isLeft(result)) return publishingErrorResponse("share-token-update-failed", 502);
  if (result.right._tag === "PublicationNotFound")
    return publishingErrorResponse("publication-not-found", 404);

  const response = Schema.decodeUnknownEither(RotatePublishedShareTokenResponseSchema)({
    schemaVersion: 1,
    versionId: parsedVersionId.right,
    token,
  });
  return Either.isLeft(response)
    ? publishingErrorResponse("share-token-response-invalid", 502)
    : privateJson(response.right, {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      });
}

export const PATCH = observeRoute("publication-token", handlePATCH);
