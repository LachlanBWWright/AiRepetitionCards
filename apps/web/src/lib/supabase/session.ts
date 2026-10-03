import { createServerClient } from "@supabase/ssr";
import { Effect, Either } from "effect";
import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseConfig } from "./config";

export async function refreshSupabaseSession(
  request: NextRequest,
  requestHeaders: Headers,
): Promise<NextResponse> {
  const forwardedHeaders = new Headers(requestHeaders);
  const nextResponse = () => NextResponse.next({ request: { headers: forwardedHeaders } });
  let response = nextResponse();
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
            // Refresh the cookie override without losing the proxy's nonce/CSP.
            forwardedHeaders.set("cookie", request.headers.get("cookie") ?? "");
            const previousCookies = response.cookies.getAll();
            response = nextResponse();
            for (const cookie of previousCookies) response.cookies.set(cookie);
            for (const { name, value, options } of cookiesToSet) {
              response.cookies.set(name, value, {
                ...options,
                httpOnly: true,
                secure:
                  request.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/",
              });
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
