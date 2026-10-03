import "server-only";

import { createClient } from "@supabase/supabase-js";
import { Effect } from "effect";
import type { OpenAiVerifiedIdentity } from "@recall/infra-openai";
import type { Database } from "@recall/infra-supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OpenAiWebConfiguration } from "./openai-config";
import { createOpenAiSignInStore } from "./openai-store";

export type OpenAiSessionError = {
  readonly _tag: "OpenAiSessionError";
  readonly reason: "unavailable" | "identity-conflict" | "sign-in-required";
};
function failure(reason: OpenAiSessionError["reason"]): OpenAiSessionError {
  return { _tag: "OpenAiSessionError", reason };
}

export function authenticatedOpenAiUser(configuration: OpenAiWebConfiguration) {
  return Effect.tryPromise({
    try: async () => {
      const client = await createSupabaseServerClient(
        configuration.supabase.url,
        configuration.supabase.publishableKey,
      );
      const { data, error } = await client.auth.getUser();
      return error ? null : (data.user?.id ?? null);
    },
    catch: () => failure("unavailable"),
  });
}

/** Establishes the application's canonical session. Provider emails never select or link accounts. */
export function establishOpenAiSession(
  configuration: OpenAiWebConfiguration,
  identity: OpenAiVerifiedIdentity,
  linkedUserId: string | null,
) {
  return Effect.gen(function* () {
    const store = createOpenAiSignInStore(configuration.store);
    const mapped = yield* store
      .readIdentity(identity)
      .pipe(Effect.mapError(() => failure("unavailable")));
    if (linkedUserId && mapped && mapped !== linkedUserId)
      return yield* Effect.fail(failure("identity-conflict"));
    const admin = createClient<Database>(configuration.supabase.url, configuration.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const request = <A>(operation: () => Promise<A>) =>
      Effect.tryPromise({ try: operation, catch: () => failure("unavailable") });
    const key = yield* store
      .identityKey(identity)
      .pipe(Effect.mapError(() => failure("unavailable")));
    let userId = linkedUserId ?? mapped;
    if (!userId) {
      const email = `chatgpt+${key.slice(0, 48)}@identity.recall.invalid`;
      const created = yield* request(() =>
        admin.auth.admin.createUser({
          email,
          email_confirm: true,
          app_metadata: { openai_identity_key: key },
          user_metadata: identity.name ? { name: identity.name } : {},
        }),
      );
      if (!created.error && created.data.user) userId = created.data.user.id;
      else {
        // A concurrent callback can have created the same internal alias. Only verified metadata permits recovery.
        const recovered = yield* request(() =>
          admin.auth.admin.generateLink({ type: "magiclink", email }),
        );
        if (
          recovered.error ||
          !recovered.data.user ||
          recovered.data.user.app_metadata.openai_identity_key !== key ||
          recovered.data.user.email !== email
        )
          return yield* Effect.fail(failure("unavailable"));
        userId = recovered.data.user.id;
      }
    }
    const canonicalUserId = userId;
    const account = yield* request(() => admin.auth.admin.getUserById(canonicalUserId));
    if (account.error || !account.data.user?.email || account.data.user.id !== canonicalUserId)
      return yield* Effect.fail(failure("unavailable"));
    yield* store
      .bindIdentity(identity, canonicalUserId)
      .pipe(
        Effect.mapError((error) =>
          failure(error.reason === "conflict" ? "identity-conflict" : "unavailable"),
        ),
      );
    if (linkedUserId) return canonicalUserId;
    const link = yield* request(() =>
      admin.auth.admin.generateLink({ type: "magiclink", email: account.data.user.email ?? "" }),
    );
    if (link.error || link.data.user?.id !== canonicalUserId || !link.data.properties?.hashed_token)
      return yield* Effect.fail(failure("unavailable"));
    const session = yield* request(async () => {
      const client = await createSupabaseServerClient(
        configuration.supabase.url,
        configuration.supabase.publishableKey,
      );
      const result = await client.auth.verifyOtp({
        token_hash: link.data.properties.hashed_token,
        type: "magiclink",
      });
      if (result.error || result.data.user?.id !== canonicalUserId) {
        await client.auth.signOut({ scope: "local" });
        return false;
      }
      return true;
    });
    if (!session) return yield* Effect.fail(failure("unavailable"));
    return canonicalUserId;
  });
}
