import { Effect, Either } from "effect";
import { designTokens } from "@recall/design-tokens";
import { supabaseAuthClient } from "../../storage/auth/supabase-auth";
import { makeNativePublishingClients } from "../../storage/publishing/native-publishing-api";
export const palette = designTokens.color;
export const nativePublishingClients = makeNativePublishingClients(
  process.env.EXPO_PUBLIC_RECALL_API_URL ?? "",
  async () => {
    const authClient = supabaseAuthClient;
    if (!authClient) return null;
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => authClient.auth.getSession(),
          catch: () => ({ _tag: "SessionReadError" }) as const,
        }),
      ),
    );
    return Either.isRight(result) ? (result.right.data.session?.access_token ?? null) : null;
  },
);
