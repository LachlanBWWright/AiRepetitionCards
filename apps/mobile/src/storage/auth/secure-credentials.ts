import { Effect } from "effect";
import * as SecureStore from "expo-secure-store";

const sessionKey = "recall-supabase-session";

export type CredentialStoreFailure = { readonly _tag: "CredentialStoreFailure" };

export function readSessionCredential(): Effect.Effect<string | null, CredentialStoreFailure> {
  return Effect.tryPromise({
    try: () => SecureStore.getItemAsync(sessionKey),
    catch: () => ({ _tag: "CredentialStoreFailure" }) as const,
  });
}

export function writeSessionCredential(
  credential: string,
): Effect.Effect<void, CredentialStoreFailure> {
  return Effect.tryPromise({
    try: () => SecureStore.setItemAsync(sessionKey, credential),
    catch: () => ({ _tag: "CredentialStoreFailure" }) as const,
  });
}

export function clearSessionCredential(): Effect.Effect<void, CredentialStoreFailure> {
  return Effect.tryPromise({
    try: () => SecureStore.deleteItemAsync(sessionKey),
    catch: () => ({ _tag: "CredentialStoreFailure" }) as const,
  });
}
