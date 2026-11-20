"use client";
import { ChatGPTLogo } from "@/components/auth/ChatGPTLogo";

import { sharedPublicationReturnPath } from "@/lib/auth/return-path";
import { Button } from "@/components/ui/Button";
import { toast } from "@recall/ui-web";

export function ContinueWithChatGPT({
  enabled,
  next = "/",
  mode = "sign-in",
  demo = false,
}: {
  readonly enabled: boolean;
  readonly next?: string;
  readonly mode?: "sign-in" | "link";
  readonly demo?: boolean;
}) {
  const query = new URLSearchParams({ next: sharedPublicationReturnPath(next) });
  if (mode === "link") query.set("mode", "link");
  if (!enabled || demo) {
    return (
      <Button
        size="lg"
        className="w-full"
        type="button"
        disabled={!enabled}
        onClick={demo ? () => toast.success("Mock ChatGPT sign-in started.") : undefined}
      >
        <ChatGPTLogo />
        Sign in with ChatGPT
      </Button>
    );
  }
  return (
    <Button asChild variant="default" size="lg" className="w-full">
      <a href={`/auth/openai?${query.toString()}`}>
        <ChatGPTLogo />
        Sign in with ChatGPT
      </a>
    </Button>
  );
}
