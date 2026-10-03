import { Effect, Either } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sharedReturnPathFromQuery } from "@/lib/auth/return-path";

function signInRedirect(request: NextRequest, reason: string, returnPath: string): NextResponse {
  const destination = new URL("/sign-in", request.url);
  destination.searchParams.set("status", reason);
  if (returnPath !== "/") destination.searchParams.set("next", returnPath);
  return NextResponse.redirect(destination);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const returnPath = sharedReturnPathFromQuery(url.searchParams.getAll("next"));
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (!tokenHash || type !== "email") return signInRedirect(request, "invalid-link", returnPath);

  const config = readSupabaseConfig();
  if (Either.isLeft(config)) return signInRedirect(request, "provider-not-configured", returnPath);

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
  if (Either.isLeft(result)) return signInRedirect(request, "link-expired", returnPath);
  return NextResponse.redirect(new URL(returnPath, request.url));
}
