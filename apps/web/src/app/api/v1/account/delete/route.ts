import "server-only";

import { createClient } from "@supabase/supabase-js";
import { Effect, Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { readJsonBody } from "@/lib/http/read-json";

const DeleteAccountRequestSchema = Schema.Struct({ confirmation: Schema.Literal("DELETE") });

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError") {
    const status =
      auth.reason === "not-configured" ? 503 : auth.reason === "unauthenticated" ? 401 : 502;
    return NextResponse.json({ error: auth.reason }, { status });
  }
  const origin = request.headers.get("origin");
  const isBearerRequest = /^Bearer\s+\S+$/i.test(request.headers.get("authorization") ?? "");
  if (
    (origin !== null && origin !== request.nextUrl.origin) ||
    (origin === null && !isBearerRequest)
  ) {
    return NextResponse.json({ error: "invalid-origin" }, { status: 403 });
  }
  const config = readSupabaseConfig();
  if (Either.isLeft(config)) return NextResponse.json({ error: "not-configured" }, { status: 503 });
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
    return NextResponse.json(
      { error: tooLarge ? "request-too-large" : "confirmation-required" },
      { status: tooLarge ? 413 : 400 },
    );
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey)
    return NextResponse.json({ error: "account-deletion-unavailable" }, { status: 503 });
  const admin = createClient(config.right.url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const erased = await admin.rpc("erase_account_data", {
    p_user_id: auth.userId,
  });
  if (erased.error || erased.data !== true)
    return NextResponse.json({ error: "account-deletion-unavailable" }, { status: 502 });

  const deleted = await admin.auth.admin.deleteUser(auth.userId, false);
  if (deleted.error)
    return NextResponse.json({ error: "account-deletion-unavailable" }, { status: 502 });
  await auth.client.auth.signOut({ scope: "local" });
  return NextResponse.json(
    { deleted: true },
    { headers: { "cache-control": "private, no-store, max-age=0" } },
  );
}
