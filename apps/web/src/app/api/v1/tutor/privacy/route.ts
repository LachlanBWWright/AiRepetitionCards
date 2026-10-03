import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
import { supabaseApiAuthFailureStatus } from "@recall/infra-supabase";
import { observeRoute } from "@/lib/http/observe-route";
import "server-only";
import { Effect, Either, Schema } from "effect";
import { type NextRequest } from "next/server";
import {
  TutorPrivacyPolicySchema,
  DeleteTutorHistoryRequestSchema,
  DeleteTutorHistoryResponseSchema,
} from "@recall/contracts";
import { deleteOwnedTutorHistory } from "@recall/infra-supabase/tutor-privacy";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { privateJson } from "@/lib/http/private-json";
import { readJsonBody } from "@/lib/http/read-json";
import { createTutorPrivacyAdmin, readTutorRetentionPolicy } from "@/lib/tutor-privacy-config";

async function handleGET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError")
    return privateJson(
      { error: auth.reason },
      {
        status: supabaseApiAuthFailureStatus(auth.reason),
      },
    );
  const limited = await authenticatedApiRateLimit(auth.userId, "tutor-read", {
    request,
    namespace: "account",
  });
  if (limited) return limited;
  const policy = readTutorRetentionPolicy();
  if (policy === null) return privateJson({ error: "privacy-unavailable" }, { status: 503 });
  const result = Schema.decodeUnknownEither(TutorPrivacyPolicySchema)({
    schemaVersion: 1,
    ...policy,
    deletionAvailable: createTutorPrivacyAdmin() !== null,
  });
  return Either.isLeft(result)
    ? privateJson({ error: "privacy-unavailable" }, { status: 503 })
    : privateJson(result.right);
}

async function handleDELETE(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError")
    return privateJson(
      { error: auth.reason },
      {
        status: supabaseApiAuthFailureStatus(auth.reason),
      },
    );
  const limited = await authenticatedApiRateLimit(auth.userId, "workspace-sync", {
    request,
    namespace: "account",
  });
  if (limited) return limited;
  const origin = request.headers.get("origin");
  const bearer = /^Bearer\s+\S+$/i.test(request.headers.get("authorization") ?? "");
  if ((origin !== null && origin !== request.nextUrl.origin) || (origin === null && !bearer)) {
    return privateJson({ error: "invalid-origin" }, { status: 403 });
  }
  const input = await Effect.runPromise(Effect.either(readJsonBody(request, 1_024)));
  if (Either.isLeft(input))
    return privateJson(
      { error: input.left.reason },
      { status: input.left.reason === "too-large" ? 413 : 400 },
    );
  if (Either.isLeft(Schema.decodeUnknownEither(DeleteTutorHistoryRequestSchema)(input.right))) {
    return privateJson({ error: "confirmation-required" }, { status: 400 });
  }
  const admin = createTutorPrivacyAdmin();
  if (admin === null) return privateJson({ error: "privacy-unavailable" }, { status: 503 });
  const deleted = await Effect.runPromise(
    Effect.either(deleteOwnedTutorHistory(admin, auth.userId)),
  );
  if (Either.isLeft(deleted)) return privateJson({ error: "privacy-unavailable" }, { status: 502 });
  const output = Schema.decodeUnknownEither(DeleteTutorHistoryResponseSchema)({
    schemaVersion: 1,
    deleted: true,
    deletedSessions: deleted.right,
  });
  return Either.isLeft(output)
    ? privateJson({ error: "privacy-unavailable" }, { status: 502 })
    : privateJson(output.right);
}

export const GET = observeRoute("tutor-privacy-read", handleGET);

export const DELETE = observeRoute("tutor-privacy-delete", handleDELETE);
