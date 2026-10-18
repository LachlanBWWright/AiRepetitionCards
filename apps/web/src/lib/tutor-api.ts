import { Effect } from "effect";
import {
  createTutorApi,
  executeBudgetedTutorRequest,
  type TutorHttpRequest,
} from "@recall/application";
import { browserLocalBudget } from "./local-ai-budget";
import { readBrowserSession } from "./auth/browser-session";
import { apiFetch } from "@/lib/desktop-api";

export const tutorApi = createTutorApi((request) =>
  Effect.gen(function* () {
    const session =
      request.method === "POST"
        ? yield* readBrowserSession().pipe(
            Effect.mapError(() => ({ _tag: "TutorTransportError" }) as const),
          )
        : null;
    return yield* executeBudgetedTutorRequest(
      request,
      session?.ownerId ?? null,
      () => sendTutorRequest(request, session?.ownerId ?? null),
      { budget: browserLocalBudget, now: Date.now, createId: () => crypto.randomUUID() },
    );
  }),
);

function sendTutorRequest(request: TutorHttpRequest, ownerId: string | null) {
  return Effect.tryPromise({
    try: async () => {
      const response = await apiFetch(request.path, {
        method: request.method,
        headers: {
          ...(request.body === undefined ? {} : { "content-type": "application/json" }),
          ...(ownerId ? { "x-recall-workspace-owner": ownerId } : {}),
        },
        ...(request.body === undefined
          ? {}
          : {
              body: JSON.stringify(request.body),
            }),
      });
      let body: unknown = null;
      try {
        body = (await response.json()) as unknown;
      } catch {
        body = null;
      }
      return { status: response.status, body };
    },
    catch: () => ({ _tag: "TutorTransportError" }) as const,
  });
}
