"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert, Input, toast } from "@recall/ui-web";
import { Effect, Either, Schema } from "effect";

const AuthStatusSchema = Schema.Struct({
  configured: Schema.Boolean,
  email: Schema.NullOr(Schema.String),
  secureStorageAvailable: Schema.Boolean,
});
const AuthEventSchema = Schema.Struct({ email: Schema.NullOr(Schema.String) });
const BooleanReplySchema = Schema.Struct({
  _tag: Schema.Literal("Success"),
  value: Schema.Boolean,
});
const AuthCallbackSchema = Schema.Struct({ confirmed: Schema.Boolean });

export function DesktopAccountAction() {
  const [email, setEmail] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [configured, setConfigured] = useState(false);
  const [secureStorageAvailable, setSecureStorageAvailable] = useState(false);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const desktop = window.recallDesktop;
    if (!desktop) return;
    let active = true;
    const publishStatus = (input: unknown) => {
      if (typeof input !== "object" || input === null || !("value" in input)) return;
      const decoded = Schema.decodeUnknownEither(AuthStatusSchema)(input.value);
      if (Either.isLeft(decoded) || !active) return;
      setConfigured(decoded.right.configured);
      setSecureStorageAvailable(decoded.right.secureStorageAvailable);
      setEmail(decoded.right.email);
    };
    const stateSubscription = desktop.auth.onStateChanged((input) => {
      const decoded = Schema.decodeUnknownEither(AuthEventSchema)(input);
      if (Either.isRight(decoded) && active) setEmail(decoded.right.email);
    });
    const callbackSubscription = desktop.auth.onSignInResult((input) => {
      const decoded = Schema.decodeUnknownEither(AuthCallbackSchema)(input);
      if (!active || Either.isLeft(decoded)) return;
      if (decoded.right.confirmed) {
        setNotice(null);
        toast.success("Signed in. Cloud sync and tutor sessions are ready.");
      } else
        setNotice("That sign-in link could not be verified. Request a new link and try again.");
    });
    void Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => desktop.auth.getStatus(),
          catch: () => ({ _tag: "DesktopAuthStatusFailure" }) as const,
        }),
      ),
    ).then((result) => {
      if (active && Either.isRight(result)) publishStatus(result.right);
    });
    return () => {
      active = false;
      stateSubscription();
      callbackSubscription();
    };
  }, []);

  async function requestMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const desktop = window.recallDesktop;
    if (!desktop) return;
    setSending(true);
    setNotice(null);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => desktop.auth.requestMagicLink(address.trim()),
          catch: () => ({ _tag: "DesktopMagicLinkFailure" }) as const,
        }),
      ),
    );
    const decoded = Either.isRight(result)
      ? Schema.decodeUnknownEither(BooleanReplySchema)(result.right)
      : null;
    if (decoded && Either.isRight(decoded) && decoded.right.value) {
      setNotice(null);
      toast.success("Check your email for a sign-in link. Return here to finish signing in.");
    } else
      setNotice(
        "A sign-in link could not be sent. Check the desktop Supabase settings and try again.",
      );
    setSending(false);
  }

  async function signOut() {
    const desktop = window.recallDesktop;
    if (!desktop) return;
    setBusy(true);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => desktop.auth.signOut(),
          catch: () => ({ _tag: "DesktopSignOutFailure" }) as const,
        }),
      ),
    );
    const decoded = Either.isRight(result)
      ? Schema.decodeUnknownEither(BooleanReplySchema)(result.right)
      : null;
    if (decoded && Either.isRight(decoded) && decoded.right.value) {
      setEmail(null);
      setNotice(null);
      toast.success("Signed out on this device.");
    } else {
      setNotice("Sign-out failed. The encrypted session may still be stored on this device.");
    }
    setBusy(false);
  }

  return (
    <div data-slot="account-action" className="flex flex-wrap items-center gap-2">
      {email ? (
        <>
          <span className="mr-auto text-sm text-muted-foreground">{email}</span>
          <Button variant="secondary" type="button" disabled={busy} onClick={() => void signOut()}>
            {busy ? "Signing out…" : "Sign out"}
          </Button>
        </>
      ) : configured && secureStorageAvailable ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => void requestMagicLink(event)}
        >
          <label className="sr-only" htmlFor="desktop-account-email">
            Email address
          </label>
          <Input
            id="desktop-account-email"
            type="email"
            autoComplete="email"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="you@example.com"
            required
          />
          <Button variant="secondary" type="submit" disabled={sending}>
            {sending ? "Sending…" : "Email sign-in link"}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          {!configured
            ? "Cards and review history are saved on this device. No account is needed to study."
            : "Set up an OS keyring to store your encrypted sign-in session."}
        </p>
      )}
      {notice ? <Alert variant="destructive">{notice}</Alert> : null}
    </div>
  );
}
