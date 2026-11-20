"use client";

import { useState } from "react";
import { Effect, Either } from "effect";
import { startGoogleSignIn } from "@recall/infra-supabase/google-sign-in";
import { toast } from "@recall/ui-web";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { readSupabaseConfig } from "@/lib/supabase/config";

export function useGoogleSignIn(next: string, demo: boolean, initialMessage?: string) {
  const [message, setMessage] = useState<string | null>(initialMessage ?? null);
  const [submitting, setSubmitting] = useState(false);

  async function signIn() {
    if (submitting) return;
    if (demo) {
      toast.success("Mock Google sign-in started.");
      return;
    }
    const config = readSupabaseConfig();
    const client = createSupabaseBrowserClient();
    if (Either.isLeft(config) || !client) {
      setMessage("Google sign-in is unavailable right now. Please try again later.");
      return;
    }
    const callback = new URL("/auth/confirm", window.location.origin);
    callback.searchParams.set("next", next);
    setSubmitting(true);
    setMessage(null);
    const result = await Effect.runPromise(
      Effect.either(
        startGoogleSignIn(
          config.right.url,
          () =>
            client.auth.signInWithOAuth({
              provider: "google",
              options: { redirectTo: callback.toString(), skipBrowserRedirect: true },
            }),
          (url) => {
            window.location.assign(url);
            return Promise.resolve();
          },
        ),
      ),
    );
    if (Either.isLeft(result)) {
      setSubmitting(false);
      setMessage("Google sign-in could not start. Please try again.");
    }
  }

  return { message, submitting, signIn };
}
