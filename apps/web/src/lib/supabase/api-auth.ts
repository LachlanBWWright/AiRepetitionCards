import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Either, Effect } from "effect";
import { readSupabaseConfig } from "./config";
import { createSupabaseServerClient } from "./server";

export type ApiAuthResult =
  | { readonly _tag: "Authenticated"; readonly client: SupabaseClient; readonly userId: string }
  | {
      readonly _tag: "ContextError";
      readonly reason: "not-configured" | "unauthenticated" | "unavailable";
    };

export async function authenticateApiRequest(request: Request): Promise<ApiAuthResult> {
  const config = readSupabaseConfig();
  if (Either.isLeft(config)) return { _tag: "ContextError", reason: "not-configured" };

  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (authorization && !bearer) return { _tag: "ContextError", reason: "unauthenticated" };

  const result = await Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: async () => {
          const client = bearer
            ? createClient(config.right.url, config.right.publishableKey, {
                auth: {
                  autoRefreshToken: false,
                  detectSessionInUrl: false,
                  persistSession: false,
                },
              })
            : await createSupabaseServerClient(config.right.url, config.right.publishableKey);
          const claims = await client.auth.getClaims(bearer);
          return { client, userId: claims.data?.claims?.sub ?? null };
        },
        catch: () => ({ _tag: "SupabaseApiAuthError" }) as const,
      }),
    ),
  );
  if (Either.isLeft(result)) return { _tag: "ContextError", reason: "unavailable" };
  if (!result.right.userId) return { _tag: "ContextError", reason: "unauthenticated" };
  return { _tag: "Authenticated", ...result.right, userId: result.right.userId };
}
