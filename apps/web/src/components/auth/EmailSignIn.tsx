"use client";

import { useId, useState } from "react";
import { Effect, Either } from "effect";
import { Input, Label, Alert } from "@recall/ui-web";
import { Button } from "@/components/ui/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { requestEmailSignIn } from "@/lib/auth/request-email-sign-in";

export function EmailSignIn({ next, demo }: { readonly next: string; readonly demo: boolean }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    readonly failed: boolean;
    readonly message: string;
  } | null>(null);

  async function submit() {
    const client = createSupabaseBrowserClient();
    if (!demo && !client) {
      setResult({ failed: true, message: "Sign-in is unavailable right now. Try again later." });
      return;
    }
    setPending(true);
    setResult(null);
    const callback = new URL("/auth/confirm", window.location.origin);
    callback.searchParams.set("next", next);
    const outcome = await Effect.runPromise(
      Effect.either(
        requestEmailSignIn(email, (address) =>
          demo || !client
            ? Promise.resolve({ error: null })
            : client.auth.signInWithOtp({
                email: address,
                options: { emailRedirectTo: callback.toString() },
              }),
        ),
      ),
    );
    setResult(
      Either.isLeft(outcome)
        ? { failed: true, message: outcome.left }
        : { failed: false, message: outcome.right },
    );
    setPending(false);
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Label htmlFor={id}>Email address</Label>
      <Input
        id={id}
        type="email"
        autoComplete="email"
        required
        value={email}
        disabled={pending}
        onChange={(event) => {
          setEmail(event.target.value);
        }}
        placeholder="you@example.com"
      />
      <Button className="w-full" type="submit" disabled={pending}>
        {pending ? "Sending link…" : "Email me a sign-in link"}
      </Button>
      {result && (
        <Alert role="status" variant={result.failed ? "destructive" : "default"}>
          {result.message}
        </Alert>
      )}
    </form>
  );
}
