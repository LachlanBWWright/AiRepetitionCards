"use client";

import { useEffect, useState } from "react";
import { Alert } from "@recall/ui-web";
import { Effect, Fiber, Schema } from "effect";
import { ContinueWithChatGPT } from "./ContinueWithChatGPT";

const CapabilitiesSchema = Schema.Struct({
  enabled: Schema.Boolean,
  linkingAvailable: Schema.Boolean,
});

export function ChatGPTAccountConnection({
  demo = false,
  demoAvailable = false,
  demoMessage,
  compact = false,
}: {
  readonly demo?: boolean;
  readonly demoAvailable?: boolean;
  readonly demoMessage?: string;
  readonly compact?: boolean;
}) {
  const [linkingAvailable, setLinkingAvailable] = useState(false);

  useEffect(() => {
    if (demo) return;
    let mounted = true;
    const lookup = Effect.tryPromise({
      try: (signal) => fetch("/api/v1/auth/openai/capabilities", { signal }),
      catch: () => ({ _tag: "AuthCapabilitiesUnavailable" }) as const,
    }).pipe(
      Effect.filterOrFail(
        (response) => response.ok,
        () => ({ _tag: "AuthCapabilitiesUnavailable" }) as const,
      ),
      Effect.flatMap((response) =>
        Effect.tryPromise({
          try: (): Promise<unknown> => response.json(),
          catch: () => ({ _tag: "AuthCapabilitiesUnavailable" }) as const,
        }),
      ),
      Effect.flatMap(Schema.decodeUnknown(CapabilitiesSchema)),
      Effect.match({
        onFailure: () => false,
        onSuccess: (capabilities) => capabilities.enabled && capabilities.linkingAvailable,
      }),
      Effect.tap((available) =>
        Effect.sync(() => {
          if (mounted) setLinkingAvailable(available);
        }),
      ),
    );
    const fiber = Effect.runFork(lookup);
    return () => {
      mounted = false;
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [demo]);

  const available = demo ? demoAvailable : linkingAvailable;
  if (!available && !demo) return null;
  if (compact) {
    return (
      <a className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={demo ? undefined : "/auth/openai?mode=link&next=%2F"}>
        Link ChatGPT
      </a>
    );
  }
  return (
    <section className="w-full max-w-[410px]" aria-label="ChatGPT account connection">
      <p className="text-sm leading-relaxed text-muted-foreground">Link ChatGPT as another way to sign in to this Recall account.</p>
      <ContinueWithChatGPT enabled={available} mode="link" demo={demo} />
      {demoMessage && (
        <Alert role="status">
          {demoMessage}
        </Alert>
      )}
    </section>
  );
}
