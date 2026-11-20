import { createClient } from "@supabase/supabase-js";
import { Effect } from "effect";
import * as Linking from "expo-linking";
import { completeGoogleSignIn, startGoogleSignIn } from "@recall/infra-supabase/google-sign-in";
import * as SecureStore from "expo-secure-store";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export const supabaseAuthClient =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
          flowType: "pkce",
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

export function signInNativeWithGoogle() {
  const client = supabaseAuthClient;
  if (!client || !supabaseUrl) return Effect.succeed(false);
  return startGoogleSignIn(
    supabaseUrl,
    () =>
      client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: Linking.createURL("auth/confirm"), skipBrowserRedirect: true },
      }),
    async (url) => {
      await Linking.openURL(url);
    },
  ).pipe(Effect.as(true));
}

export function confirmNativeGoogleSignIn(url: string) {
  const client = supabaseAuthClient;
  if (!client) return Effect.succeed(false);
  return completeGoogleSignIn(url, Linking.createURL("auth/confirm"), (code) =>
    client.auth.exchangeCodeForSession(code),
  );
}
