"use client";

import { useState } from "react";
import Link from "next/link";
import { Effect, Either } from "effect";
import { Alert, toast } from "@recall/ui-web";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { sharedPublicationReturnPath } from "@/lib/auth/return-path";
import { ChatGPTIdentityOption } from "./ChatGPTIdentityOption";
import { EmailSignIn } from "./EmailSignIn";
import { OAuthSignInButtons } from "./OAuthSignInButtons";

export function SignInScreen({
  chatGptEnabled = false,
  supabaseEnabled = Either.isRight(readSupabaseConfig()),
  next = "/",
  initialMessage,
  demo = false,
  oauthProviders = ["apple", "google"],
}: {
  readonly chatGptEnabled?: boolean;
  readonly supabaseEnabled?: boolean;
  readonly next?: string;
  readonly initialMessage?: string;
  readonly demo?: boolean;
  readonly oauthProviders?: readonly ("apple" | "google")[];
}) {
  const returnPath = sharedPublicationReturnPath(next);
  const [message, setMessage] = useState<string | null>(initialMessage ?? null);
  const [submitting, setSubmitting] = useState(false);

  async function signInWithProvider(provider: "apple" | "google") {
    if (demo) {
      toast.success(`Mock ${provider === "apple" ? "Apple" : "Google"} sign-in started.`);
      return;
    }
    const client = createSupabaseBrowserClient();
    if (!client) {
      setMessage("Sign-in could not be started. Please try again.");
      return;
    }

    const callback = new URL("/auth/confirm", window.location.origin);
    callback.searchParams.set("next", returnPath);
    setSubmitting(true);
    setMessage(null);
    const request = Effect.tryPromise({
      try: () =>
        client.auth.signInWithOAuth({
          provider,
          options: { redirectTo: callback.toString() },
        }),
      catch: () => ({ _tag: "OAuthSignInError" }) as const,
    }).pipe(
      Effect.flatMap(({ error }) =>
        error ? Effect.fail({ _tag: "OAuthSignInError" } as const) : Effect.succeed(undefined),
      ),
    );
    const result = await Effect.runPromise(Effect.either(request));
    if (Either.isLeft(result)) {
      setSubmitting(false);
      setMessage(
        `${provider === "apple" ? "Apple" : "Google"} sign-in could not start. Please try again.`,
      );
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-10">
      <Link
        className="flex items-center gap-2 text-xl font-bold tracking-tight no-underline"
        href="/"
      >
        <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
          r
        </span>
        <span>
          recall<span className="text-primary">.</span>
        </span>
      </Link>
      <section className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          WEB WORKSPACE
        </p>
        <h1 className="my-0 text-3xl font-semibold tracking-tight">Sign in to continue.</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {supabaseEnabled
            ? "Sign in to save your cards and study progress to your Recall account."
            : "Sign-in is unavailable right now. You can return to the shared area."}
        </p>
        {!supabaseEnabled ? (
          returnPath !== "/" && (
            <Link
              className="text-sm underline underline-offset-4 hover:text-primary"
              href={returnPath}
            >
              ← Return to the shared area
            </Link>
          )
        ) : (
          <>
            <EmailSignIn next={returnPath} demo={demo} />
            <OAuthSignInButtons
              providers={oauthProviders}
              busy={submitting}
              onSelect={(provider) => {
                void signInWithProvider(provider);
              }}
            />
            <ChatGPTIdentityOption enabled={chatGptEnabled} next={returnPath} demo={demo} />
            {message && <Alert variant="destructive">{message}</Alert>}
          </>
        )}
        {!supabaseEnabled && message && <Alert role="status">{message}</Alert>}
      </section>
    </main>
  );
}
