import { createClient } from "@supabase/supabase-js";
import { Effect } from "effect";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export const supabaseAuthClient =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: false,
          persistSession: true,
          storage: {
            getItem: (key) => SecureStore.getItemAsync(key),
            setItem: (key, value) => SecureStore.setItemAsync(key, value),
            removeItem: (key) => SecureStore.deleteItemAsync(key),
          },
        },
      })
    : null;

export type NativeAuthFailure = {
  readonly _tag: "NativeAuthFailure";
  readonly operation: "send-magic-link" | "verify-magic-link";
};

export function sendNativeMagicLink(email: string): Effect.Effect<boolean, NativeAuthFailure> {
  if (!supabaseAuthClient) return Effect.succeed(false);
  return Effect.map(
    Effect.tryPromise({
      try: () =>
        supabaseAuthClient.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: Linking.createURL("auth/confirm") },
        }),
      catch: (): NativeAuthFailure => ({
        _tag: "NativeAuthFailure",
        operation: "send-magic-link",
      }),
    }),
    (result) => result.error === null,
  );
}

export function confirmNativeMagicLink(url: string): Effect.Effect<boolean, NativeAuthFailure> {
  if (!supabaseAuthClient) return Effect.succeed(false);
  const parsed = Effect.try({
    try: () => ({
      value: Linking.parse(url),
      expectedCallback: Linking.parse(Linking.createURL("auth/confirm")),
    }),
    catch: (): NativeAuthFailure => ({
      _tag: "NativeAuthFailure",
      operation: "verify-magic-link",
    }),
  });
  return Effect.flatMap(parsed, ({ value, expectedCallback }) => {
    const tokenHash = value.queryParams?.token_hash;
    const type = value.queryParams?.type;
    if (
      value.scheme !== expectedCallback.scheme ||
      value.hostname !== expectedCallback.hostname ||
      value.path !== expectedCallback.path ||
      typeof tokenHash !== "string" ||
      tokenHash.length === 0 ||
      tokenHash.length > 2_000 ||
      type !== "email"
    ) {
      return Effect.succeed(false);
    }
    return Effect.map(
      Effect.tryPromise({
        try: () => supabaseAuthClient.auth.verifyOtp({ token_hash: tokenHash, type: "email" }),
        catch: (): NativeAuthFailure => ({
          _tag: "NativeAuthFailure",
          operation: "verify-magic-link",
        }),
      }),
      (result) => result.error === null,
    );
  });
}
