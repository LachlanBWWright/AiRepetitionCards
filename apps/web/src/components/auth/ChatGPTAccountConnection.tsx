"use client";
import { Button } from "@recall/ui-web";

import { ChatGPTLogo } from "@/components/auth/ChatGPTLogo";

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
      <Button asChild variant="default" size="default">
        <a href={demo ? undefined : "/auth/openai?mode=link&next=%2F"}>
          <ChatGPTLogo />
          Link ChatGPT
        </a>
      </Button>
    );
  }
  return (
    <section
      className="flex w-full max-w-3xl flex-col gap-4"
      aria-label="ChatGPT account connection"
    >
      <p className="m-0 text-sm leading-relaxed text-muted-foreground">
        <ChatGPTLogo />
        Link ChatGPT as another way to sign in to this Recall account.
      </p>
      <ContinueWithChatGPT enabled={available} mode="link" demo={demo} />
      {demoMessage && <Alert role="status">{demoMessage}</Alert>}
    </section>
  );
}
