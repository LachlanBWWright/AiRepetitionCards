"use client";

import { sharedPublicationReturnPath } from "@/lib/auth/return-path";

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
      <button className="chatgpt-auth-button" type="button" disabled={!enabled}>
        Continue with ChatGPT
      </button>
    );
  }
  return (
    <a className="chatgpt-auth-button" href={`/auth/openai?${query.toString()}`}>
      Continue with ChatGPT
    </a>
  );
}
