import { apiFetch } from "@/lib/desktop-api";
import { readFundingPreference } from "@/lib/ai/browser-funding-preference";
import { Effect } from "effect";
import { createActivityServices, type ActivityFailure } from "@recall/application";
export function createBrowserActivityServices(expectedOwner?: string) {
  return createActivityServices((request) =>
    Effect.tryPromise({
      try: async () => {
        const managed = request.path.endsWith("/question") || request.path.endsWith("/assess");
        if (
          managed &&
          (!expectedOwner ||
            (await Effect.runPromise(readFundingPreference(expectedOwner))) !== "managed")
        )
          return {
            status: 403,
            body: { error: "Choose Recall managed AI in Account → AI settings for AI assessment." },
          };
        const response = await apiFetch(request.path, {
          method: request.method,
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(request.path === "/api/v1/activities" ? 30_000 : 75_000),
          headers: {
            ...(managed
              ? { "x-recall-ai-funding": "managed", "x-recall-ai-request-id": crypto.randomUUID() }
              : {}),
            ...(expectedOwner ? { "x-recall-owner": expectedOwner } : {}),
            ...(request.body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        });
        return { status: response.status, body: (await response.json()) as unknown };
      },
      catch: (): ActivityFailure => ({
        _tag: "ActivityFailure",
        reason: "assessment-unavailable",
        message: "Learning services could not be reached. Your work is retained.",
      }),
    }),
  );
}
