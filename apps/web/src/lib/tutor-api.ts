import { Effect, Either } from "effect";
import { createTutorApi } from "@recall/application";
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
    const reservation = session?.ownerId
      ? {
          requestId: crypto.randomUUID(),
          accountId: `hosted:${session.ownerId}`,
          model: "hosted-provider",
          task: "tutor" as const,
          startedAt: Date.now(),
        }
      : null;
    if (request.method === "POST" && !reservation)
      return { status: 401, body: { error: "Sign in before making AI requests." } };
    if (reservation) {
      const admitted = yield* Effect.either(browserLocalBudget.reserve(reservation));
      if (Either.isLeft(admitted)) return { status: 429, body: { error: admitted.left.message } };
    }
    const response = yield* Effect.tryPromise({
      try: async () => {
        const response = await apiFetch(request.path, {
          method: request.method,
          headers: {
            ...(request.body === undefined ? {} : { "content-type": "application/json" }),
            ...(session?.ownerId ? { "x-recall-workspace-owner": session.ownerId } : {}),
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
    }).pipe(
      Effect.onError(() =>
        reservation
          ? browserLocalBudget
              .settle({
                requestId: reservation.requestId,
                finishedAt: Date.now(),
                outcome: "failed",
                inputTokens: null,
                outputTokens: null,
              })
              .pipe(Effect.ignore)
          : Effect.void,
      ),
    );
    if (reservation)
      yield* browserLocalBudget
        .settle({
          requestId: reservation.requestId,
          finishedAt: Date.now(),
          outcome: response.status >= 200 && response.status < 300 ? "completed" : "failed",
          inputTokens: null,
          outputTokens: null,
        })
        .pipe(Effect.mapError(() => ({ _tag: "TutorTransportError" }) as const));
    return response;
  }),
);
