import { Effect, Either, Schema } from "effect";
import type { NextRequest } from "next/server";
import {
  WorkspaceReviewIdentitiesRequestSchema,
  WorkspaceReviewIdentitiesResponseSchema,
} from "@recall/contracts";
import { supabaseApiAuthFailureStatus } from "@recall/infra-supabase";
import { readWorkspaceReviewIdentities } from "@recall/infra-supabase/workspace-review-identities";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
import { readJsonBody } from "@/lib/http/read-json";
import { privateJson } from "@/lib/http/private-json";
import { observeRoute } from "@/lib/http/observe-route";

async function handlePOST(request: NextRequest) {
  const connected = await authenticateApiRequest(request);
  if (connected._tag === "ContextError")
    return privateJson(
      { error: connected.reason },
      { status: supabaseApiAuthFailureStatus(connected.reason) },
    );
  const limited = await authenticatedApiRateLimit(connected.userId, "workspace-sync", { request });
  if (limited) return limited;
  if (request.nextUrl.searchParams.size > 0)
    return privateJson({ error: "invalid-request" }, { status: 400 });
  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 8_192)));
  if (Either.isLeft(body))
    return privateJson(
      { error: body.left.reason === "too-large" ? "request-too-large" : "invalid-request" },
      { status: body.left.reason === "too-large" ? 413 : 400 },
    );
  const decoded = Schema.decodeUnknownEither(WorkspaceReviewIdentitiesRequestSchema)(body.right);
  if (Either.isLeft(decoded)) return privateJson({ error: "invalid-request" }, { status: 400 });
  const identities = await Effect.runPromise(
    Effect.either(
      readWorkspaceReviewIdentities(connected.client, connected.userId, decoded.right.cardIds),
    ),
  );
  if (Either.isLeft(identities))
    return privateJson({ error: "workspace-unavailable" }, { status: 503 });
  const requested = new Set<string>(decoded.right.cardIds);
  const response = Schema.decodeUnknownEither(WorkspaceReviewIdentitiesResponseSchema)({
    schemaVersion: 1,
    ownerId: connected.userId,
    reviewCards: identities.right,
  });
  if (Either.isLeft(response) || response.right.reviewCards.some((card) => !requested.has(card.id)))
    return privateJson({ error: "workspace-unavailable" }, { status: 503 });
  return privateJson(response.right);
}

export const POST = observeRoute("workspace-review-identities", handlePOST);
