import { Effect, Either } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return NextResponse.json(
      { error: "invalid-origin" },
      { status: 403, headers: { "cache-control": "private, no-store" } },
    );
  const config = readSupabaseConfig();
  if (Either.isLeft(config)) {
    return NextResponse.redirect(new URL("/", request.url), { status: 303 });
  }

  const signOut = Effect.tryPromise({
    try: async () => {
      const client = await createSupabaseServerClient(
        config.right.url,
        config.right.publishableKey,
      );
      return client.auth.signOut({ scope: "local" });
    },
    catch: () => ({ _tag: "SignOutError" }) as const,
  }).pipe(
    Effect.flatMap(({ error }) =>
      error ? Effect.fail({ _tag: "SignOutError" } as const) : Effect.succeed(undefined),
    ),
  );
  const result = await Effect.runPromise(Effect.either(signOut));
  const destination = new URL(result._tag === "Right" ? "/" : "/sign-in", request.url);
  return NextResponse.redirect(destination, { status: 303 });
}
