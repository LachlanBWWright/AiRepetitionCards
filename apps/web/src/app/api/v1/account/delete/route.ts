import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
import { supabaseApiAuthFailureStatus } from "@recall/infra-supabase";
import { observeRoute } from "@/lib/http/observe-route";
import "server-only";

import { createClient } from "@supabase/supabase-js";
import { Effect, Either, Schema, Schedule } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { privateJson } from "@/lib/http/private-json";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { readJsonBody } from "@/lib/http/read-json";
import { DeleteAccountRequestSchema, DeleteAccountResponseSchema } from "@recall/contracts";
import type { Database } from "@recall/infra-supabase";
import { deleteAccount } from "@recall/infra-supabase/account-deletion";
import { readOpenAiIdentityStoreConfiguration } from "@/lib/auth/openai-config";
import { createOpenAiSignInStore } from "@/lib/auth/openai-store";

async function handlePOST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError") {
    const status = supabaseApiAuthFailureStatus(auth.reason);
    return privateJson({ error: auth.reason }, { status });
  }
  const limited = await authenticatedApiRateLimit(auth.userId, "workspace-sync", {
    request,
    namespace: "account",
  });
  if (limited) return limited;
  const origin = request.headers.get("origin");
  const isBearerRequest = /^Bearer\s+\S+$/i.test(request.headers.get("authorization") ?? "");
  if (
    (origin !== null && origin !== request.nextUrl.origin) ||
    (origin === null && !isBearerRequest)
  ) {
    return privateJson({ error: "invalid-origin" }, { status: 403 });
  }
  const config = readSupabaseConfig();
  if (Either.isLeft(config)) return privateJson({ error: "not-configured" }, { status: 503 });
  const confirmationBody = await Effect.runPromise(
    Effect.either(
      Effect.map(readJsonBody(request, 1_024), (input) =>
        Schema.decodeUnknownEither(DeleteAccountRequestSchema)(input),
      ),
    ),
  );
  if (Either.isLeft(confirmationBody) || Either.isLeft(confirmationBody.right)) {
    const tooLarge =
      Either.isLeft(confirmationBody) && confirmationBody.left.reason === "too-large";
    return privateJson(
      { error: tooLarge ? "request-too-large" : "confirmation-required" },
      { status: tooLarge ? 413 : 400 },
    );
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey)
    return privateJson({ error: "account-deletion-unavailable" }, { status: 503 });
  const admin = createClient<Database>(config.right.url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const identityStore = readOpenAiIdentityStoreConfiguration();
  const identityStoreRequested = Boolean(
    process.env.SIWC_STORE_REST_URL ||
    process.env.SIWC_STORE_REST_TOKEN ||
    process.env.SIWC_IDENTITY_KEY_SECRET,
  );
  if (identityStoreRequested && identityStore === null) {
    return privateJson({ error: "account-deletion-cleanup-unavailable" }, { status: 503 });
  }
  if (identityStore !== null) {
    const cleaned = await Effect.runPromise(
      Effect.either(
        createOpenAiSignInStore(identityStore)
          .deleteUserIdentities(auth.userId)
          .pipe(
            Effect.retry(
              Schedule.exponential("250 millis").pipe(Schedule.intersect(Schedule.recurs(2))),
            ),
          ),
      ),
    );
    if (Either.isLeft(cleaned)) {
      return privateJson({ error: "account-deletion-cleanup-unavailable" }, { status: 502 });
    }
  }
  const deleted = await Effect.runPromise(Effect.either(deleteAccount(admin, auth.userId)));
  if (Either.isLeft(deleted))
    return privateJson({ error: "account-deletion-unavailable" }, { status: 502 });
  await auth.client.auth.signOut({ scope: "local" });
  const response = Schema.decodeUnknownEither(DeleteAccountResponseSchema)({ deleted: true });
  return Either.isLeft(response)
    ? privateJson({ error: "account-deletion-unavailable" }, { status: 502 })
    : privateJson(response.right, {
        headers: { "cache-control": "private, no-store, max-age=0" },
      });
}

export const POST = observeRoute("account-delete", handlePOST);
