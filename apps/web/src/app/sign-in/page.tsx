"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Effect, Either } from "effect";
import { Button } from "@/components/ui/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { readSupabaseConfig } from "@/lib/supabase/config";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const hasConfiguration = Either.isRight(readSupabaseConfig());

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
            emailRedirectTo: `${window.location.origin}/auth/confirm`,
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
        <p className="eyebrow">YOUR LEARNING, IN SYNC</p>
        <h1>Welcome back.</h1>
        <p className="auth-copy">
          Sign in with a secure email link. Your local study workspace remains available offline.
        </p>
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
          <Button disabled={!hasConfiguration || submitting || !email.trim()} type="submit">
            {submitting ? "Sending link…" : "Email me a sign-in link"}
          </Button>
        </form>
        {!hasConfiguration && (
          <p className="auth-setup-note" role="status">
            Add the Supabase URL and publishable key to enable account sign-in.
          </p>
        )}
        {message && (
          <p className="auth-message" role="status">
            {message}
          </p>
        )}
        <Link className="auth-back" href="/">
          ← Continue with this device
        </Link>
      </section>
    </main>
  );
}
