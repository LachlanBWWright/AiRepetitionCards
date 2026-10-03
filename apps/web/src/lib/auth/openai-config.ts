import "server-only";

import { Effect, Either } from "effect";
import { readSupabaseConfig, type SupabaseConfig } from "@/lib/supabase/config";
import type { OpenAiSignInConfiguration } from "@recall/infra-openai";

export type OpenAiWebConfiguration = {
  readonly provider: OpenAiSignInConfiguration;
  readonly store: {
    readonly url: string;
    readonly token: string;
    readonly identityKeySecret: string;
    readonly prefix?: string;
  };
  readonly supabase: SupabaseConfig;
  readonly serviceRoleKey: string;
  readonly origin: string;
  readonly secureCookie: boolean;
};

export function readOpenAiIdentityStoreConfiguration(): OpenAiWebConfiguration["store"] | null {
  const url = process.env.SIWC_STORE_REST_URL?.trim();
  const token = process.env.SIWC_STORE_REST_TOKEN?.trim();
  const identityKeySecret = process.env.SIWC_IDENTITY_KEY_SECRET;
  if (!url || !token || !identityKeySecret || identityKeySecret.length < 32) return null;
  const parsed = Effect.runSync(Effect.either(Effect.try(() => new URL(url))));
  if (
    Either.isLeft(parsed) ||
    parsed.right.protocol !== "https:" ||
    parsed.right.username ||
    parsed.right.password ||
    parsed.right.search ||
    parsed.right.hash
  )
    return null;
  const prefix = process.env.SIWC_STORE_PREFIX?.trim();
  if (prefix && !/^[A-Za-z0-9:_-]{1,64}$/.test(prefix)) return null;
  return { url, token, identityKeySecret, ...(prefix ? { prefix } : {}) };
}

export function readOpenAiSignInConfiguration(): OpenAiWebConfiguration | null {
  const clientId = process.env.OPENAI_SIWC_CLIENT_ID?.trim();
  const redirectUri = process.env.OPENAI_SIWC_REDIRECT_URI?.trim();
  const method = process.env.OPENAI_SIWC_CLIENT_AUTH_METHOD?.trim();
  const clientSecret = process.env.OPENAI_SIWC_CLIENT_SECRET;
  const identityStore = readOpenAiIdentityStoreConfiguration();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const supabase = readSupabaseConfig();
  if (
    !clientId ||
    !redirectUri ||
    !identityStore ||
    clientId.length > 200 ||
    (clientSecret !== undefined && clientSecret.length > 5000) ||
    !serviceRoleKey ||
    Either.isLeft(supabase) ||
    (method !== "none" && method !== "client_secret_basic") ||
    (method === "client_secret_basic" ? !clientSecret : Boolean(clientSecret))
  )
    return null;
  const urls = Effect.runSync(Effect.either(Effect.try(() => new URL(redirectUri))));
  if (Either.isLeft(urls)) return null;
  const callback = urls.right;
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(callback.hostname);
  if (
    callback.pathname !== "/auth/openai/callback" ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password ||
    !(
      callback.protocol === "https:" ||
      (callback.protocol === "http:" && loopback && process.env.NODE_ENV !== "production")
    )
  )
    return null;
  return {
    provider: {
      clientId,
      redirectUri,
      tokenEndpointAuthentication: method,
      ...(clientSecret ? { clientSecret } : {}),
    },
    store: identityStore,
    supabase: supabase.right,
    serviceRoleKey,
    origin: callback.origin,
    secureCookie: callback.protocol === "https:",
  };
}

export function getOpenAiSignInCapabilities(): {
  readonly enabled: boolean;
  readonly linkingAvailable: boolean;
} {
  const enabled = readOpenAiSignInConfiguration() !== null;
  return { enabled, linkingAvailable: enabled };
}
