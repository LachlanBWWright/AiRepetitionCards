import { Effect } from "effect";
import * as SecureStore from "expo-secure-store";
import { decodeManagedAiStatus } from "@recall/application";
import { supabaseAuthClient } from "../auth/supabase-auth";
import { withNativeRequest } from "../native-http";

const writeLane = Effect.runSync(Effect.makeSemaphore(1));
const key = (owner: string) => `recall-ai-funding-${owner}`;
export const readNativeAiFunding = (owner: string) =>
  Effect.tryPromise({
    try: () => SecureStore.getItemAsync(key(owner)),
    catch: () => ({ message: "AI preference storage is unavailable." }),
  });
export const nativeAiFundingPorts = {
  read: readNativeAiFunding,
  write: (owner: string, mode: "byo" | "managed") =>
    writeLane.withPermits(1)(
      Effect.tryPromise({
        try: () => SecureStore.setItemAsync(key(owner), mode),
        catch: () => ({ message: "Could not save the AI funding choice." }),
      }),
    ),
  status: (owner: string) =>
    Effect.tryPromise({
      try: async (): Promise<unknown> => {
        const session = await supabaseAuthClient?.auth.getSession();
        if (session?.data.session?.user.id !== owner) return null;
        const base = process.env.EXPO_PUBLIC_RECALL_API_URL?.replace(/\/$/, "");
        if (!base) return null;
        return withNativeRequest(
          `${base}/api/v1/ai/capabilities`,
          {
            method: "GET",
            headers: { authorization: `Bearer ${session.data.session.access_token}` },
          },
          async (response) => (response.ok ? ((await response.json()) as unknown) : null),
        );
      },
      catch: () => ({ message: "Managed AI access could not be checked." }),
    }).pipe(Effect.flatMap((raw) => decodeManagedAiStatus(raw, owner))),
};

export const clearNativeAiFunding = (owner: string | null) =>
  owner === null
    ? Effect.void
    : writeLane.withPermits(1)(
        Effect.tryPromise({
          try: () => SecureStore.deleteItemAsync(key(owner)),
          catch: () => ({ message: "Could not clear the AI funding preference." }),
        }),
      );
