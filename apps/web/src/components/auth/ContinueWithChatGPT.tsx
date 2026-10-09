"use client";

import { sharedPublicationReturnPath } from "@/lib/auth/return-path";
import { Button } from "@/components/ui/Button";
import { toast } from "@recall/ui-web";

/** Approved text format; no substitute OpenAI or ChatGPT logo artwork. */
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
        className="mt-5 min-h-11 w-full"
        type="button"
        disabled={!enabled}
        onClick={demo ? () => toast.success("Mock ChatGPT sign-in started.") : undefined}
      >
        Continue with ChatGPT
      </Button>
    );
  }
  return (
    <a
      className="mt-5 flex min-h-11 w-full items-center justify-center rounded-md border bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground no-underline transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      href={`/auth/openai?${query.toString()}`}
    >
      Continue with ChatGPT
    </a>
  );
}
