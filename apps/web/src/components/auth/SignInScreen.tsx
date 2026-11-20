"use client";

import Link from "next/link";
import { Either } from "effect";
import { Alert } from "@recall/ui-web";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { sharedPublicationReturnPath } from "@/lib/auth/return-path";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { useGoogleSignIn } from "./useGoogleSignIn";

export function SignInScreen({
  supabaseEnabled = Either.isRight(readSupabaseConfig()),
  next = "/",
  initialMessage,
  demo = false,
}: {
  readonly supabaseEnabled?: boolean;
  readonly next?: string;
  readonly initialMessage?: string;
  readonly demo?: boolean;
}) {
  const returnPath = sharedPublicationReturnPath(next);
  const { message, submitting, signIn } = useGoogleSignIn(returnPath, demo, initialMessage);

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
            ? "Use your Google account to save your cards and study progress."
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
            <GoogleSignInButton busy={submitting} onClick={() => void signIn()} />
            {message && <Alert variant="destructive">{message}</Alert>}
          </>
        )}
        {!supabaseEnabled && message && <Alert role="status">{message}</Alert>}
      </section>
    </main>
  );
}
