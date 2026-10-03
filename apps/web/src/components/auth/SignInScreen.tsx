"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Effect, Either } from "effect";
import { Button } from "@/components/ui/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { sharedPublicationReturnPath } from "@/lib/auth/return-path";
import { ContinueWithChatGPT } from "./ContinueWithChatGPT";

export function SignInScreen({
  chatGptEnabled,
  emailEnabled = Either.isRight(readSupabaseConfig()),
  next = "/",
  initialMessage,
  demo = false,
}: {
  readonly chatGptEnabled: boolean;
  readonly emailEnabled?: boolean;
  readonly next?: string;
  readonly initialMessage?: string;
  readonly demo?: boolean;
}) {
  const [email, setEmail] = useState("");
  const returnPath = sharedPublicationReturnPath(next);
  const localOnly = !chatGptEnabled && !emailEnabled;
  const [message, setMessage] = useState<string | null>(initialMessage ?? null);
  const [submitting, setSubmitting] = useState(false);

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo) {
      setMessage("Check your email for a secure sign-in link.");
      return;
    }
    const client = createSupabaseBrowserClient();
    if (!client) {
      setMessage("Sign-in is not configured on this deployment yet.");
      return;
    }
    setSubmitting(true);
    setMessage(null);

    const request = Effect.tryPromise({
      try: () =>
        client.auth.signInWithOtp({
          email: email.trim(),
          options: {
            emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(returnPath)}`,
          },
        }),
      catch: () => ({ _tag: "SignInError" }) as const,
    }).pipe(
      Effect.flatMap(({ error }) =>
        error ? Effect.fail({ _tag: "SignInError" } as const) : Effect.succeed(undefined),
      ),
    );
    const result = await Effect.runPromise(Effect.either(request));
    setSubmitting(false);
    setMessage(
      Either.isRight(result)
        ? "Check your email for a secure sign-in link."
        : "We could not send a sign-in link. Check the address and try again.",
    );
  }

  return (
    <main className="auth-page">
      <Link className="brand auth-brand" href="/">
        <span className="brand-mark">r</span>
        <span>
          recall<span className="brand-dot">.</span>
        </span>
      </Link>
      <section className="auth-panel">
        <p className="eyebrow">
          {localOnly ? "YOUR LEARNING, ON THIS DEVICE" : "YOUR LEARNING, IN SYNC"}
        </p>
        <h1>{localOnly ? "Start studying locally." : "Welcome back."}</h1>
        <p className="auth-copy">
          {localOnly
            ? "Create cards, study offline, import and export learning areas, and keep private backups. Your workspace is saved on this device without an account."
            : "Choose how to sign in. Your local study workspace remains available offline."}
        </p>
        {localOnly ? (
          <>
            <Button asChild>
              <Link href="/">Continue studying locally</Link>
            </Button>
            <p className="auth-copy">
              Cloud sync, hosted tutoring and cloud sharing are optional and are not configured
              here.
            </p>
            {returnPath !== "/" && (
              <Link className="auth-back" href={returnPath}>
                ← Return to the shared area
              </Link>
            )}
          </>
        ) : (
          <>
            <ContinueWithChatGPT enabled={chatGptEnabled} next={returnPath} demo={demo} />
            {chatGptEnabled && (
              <p className="auth-copy">
                Already have a Recall account? Sign in using your existing method, then link ChatGPT
                from your account settings to keep your learning together.
              </p>
            )}
            {!chatGptEnabled && (
              <p className="auth-setup-note" role="status">
                ChatGPT sign-in is not available on this deployment yet. Use an email link or
                continue with this device.
              </p>
            )}
            <div className="auth-divider">
              <span>or use email</span>
            </div>
            <form onSubmit={sendMagicLink}>
              <label htmlFor="sign-in-email">Email address</label>
              <input
                autoComplete="email"
                id="sign-in-email"
                name="email"
                onChange={(event) => setEmail(event.currentTarget.value)}
                required
                type="email"
                value={email}
              />
              <Button disabled={!emailEnabled || submitting || !email.trim()} type="submit">
                {submitting ? "Sending link…" : "Email me a sign-in link"}
              </Button>
            </form>
            {!emailEnabled && (
              <p className="auth-setup-note" role="status">
                Email sign-in is not available on this deployment yet.
              </p>
            )}
            {message && (
              <p className="auth-message" role="status">
                {message}
              </p>
            )}
            <Link className="auth-back" href={returnPath}>
              ← Continue with this device
            </Link>
          </>
        )}
        {localOnly && message && (
          <p className="auth-message" role="status">
            {message}
          </p>
        )}
      </section>
    </main>
  );
}
