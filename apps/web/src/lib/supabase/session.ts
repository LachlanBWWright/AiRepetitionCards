import { createServerClient } from "@supabase/ssr";
import { Effect, Either } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseConfig } from "./config";

export async function refreshSupabaseSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const config = readSupabaseConfig();
  if (Either.isLeft(config)) return response;

  const refresh = Effect.tryPromise({
    try: async () => {
      const client = createServerClient(config.right.url, config.right.publishableKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
            response = NextResponse.next({ request });
            for (const { name, value, options } of cookiesToSet) {
              response.cookies.set(name, value, options);
            }
          },
        },
      });
      await client.auth.getClaims();
    },
    catch: () => ({ _tag: "SupabaseSessionError" }) as const,
  });
  const outcome = await Effect.runPromise(Effect.either(refresh));
  if (Either.isLeft(outcome)) return response;
  return response;
}
