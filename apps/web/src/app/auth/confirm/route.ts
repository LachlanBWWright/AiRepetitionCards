import { Effect, Either } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function signInRedirect(request: NextRequest, reason: string): NextResponse {
  const destination = new URL("/sign-in", request.url);
  destination.searchParams.set("status", reason);
  return NextResponse.redirect(destination);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (!tokenHash || type !== "email") return signInRedirect(request, "invalid-link");

  const config = readSupabaseConfig();
  if (Either.isLeft(config)) return signInRedirect(request, "provider-not-configured");

  const verification = Effect.tryPromise({
    try: async () => {
      const client = await createSupabaseServerClient(
        config.right.url,
        config.right.publishableKey,
      );
      return client.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    },
    catch: () => ({ _tag: "SignInConfirmationError" }) as const,
  }).pipe(
    Effect.flatMap(({ error }) =>
      error ? Effect.fail({ _tag: "SignInConfirmationError" } as const) : Effect.succeed(undefined),
    ),
  );
  const result = await Effect.runPromise(Effect.either(verification));
  if (Either.isLeft(result)) return signInRedirect(request, "link-expired");

  const requestedNext = url.searchParams.get("next");
  const safeNext =
    requestedNext?.startsWith("/") &&
    !requestedNext.startsWith("//") &&
    !requestedNext.includes("\\")
      ? requestedNext
      : "/";
  return NextResponse.redirect(new URL(safeNext, request.url));
}
