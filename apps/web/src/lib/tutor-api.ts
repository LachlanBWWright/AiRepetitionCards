import { Effect } from "effect";
import {
  createTutorApi,
  executeBudgetedTutorRequest,
  type TutorHttpRequest,
} from "@recall/application";
import { readFundingPreference } from "./ai/browser-funding-preference";
import { browserLocalBudget } from "./local-ai-budget";
import { readBrowserSession } from "./auth/browser-session";
import { apiFetch } from "@/lib/desktop-api";

export function createManagedTutorApi(expectedOwner?: string | null) {
  return createTutorApi((request) =>
    Effect.gen(function* () {
      const session = yield* readBrowserSession().pipe(
        Effect.mapError(() => ({ _tag: "TutorTransportError" }) as const),
      );
      if (expectedOwner !== undefined && session.ownerId !== expectedOwner)
        return { status: 409, body: { error: "The selected account changed. Reopen AI help." } };
      return yield* executeBudgetedTutorRequest(
        request,
        session.ownerId ?? null,
        () => sendTutorRequest(request, session.ownerId ?? null),
        { budget: browserLocalBudget, now: Date.now, createId: () => crypto.randomUUID() },
      );
    }),
  );
}
export const tutorApi = createManagedTutorApi();

function sendTutorRequest(request: TutorHttpRequest, ownerId: string | null) {
  return Effect.tryPromise({
    try: async () => {
      if (
        request.method === "POST" &&
        (!ownerId || (await Effect.runPromise(readFundingPreference(ownerId))) !== "managed")
      )
        return {
          status: 403,
          body: {
            error: "Choose Recall managed AI in Account → AI settings before sending a request.",
          },
        };
      const response = await apiFetch(request.path, {
        method: request.method,
        headers: {
          "x-recall-ai-funding": "managed",
          "x-recall-ai-request-id": crypto.randomUUID(),
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
      if (ownerId) {
        const current = await Effect.runPromise(readBrowserSession());
        if (
          current.ownerId !== ownerId ||
          (request.method === "POST" &&
            (await Effect.runPromise(readFundingPreference(ownerId))) !== "managed")
        )
          return {
            status: 409,
            body: { error: "The selected account or AI funding changed. Reopen AI help." },
          };
      }
      return { status: response.status, body };
    },
    catch: () => ({ _tag: "TutorTransportError" }) as const,
  });
}
