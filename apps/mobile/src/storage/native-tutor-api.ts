import { Effect, Either } from "effect";
import { createTutorApi, type TutorHttpRequest } from "@recall/application";
import { nativeLocalBudget } from "./native-local-ai-budget";
import * as Crypto from "expo-crypto";
import { withNativeRequest } from "./native-http";

/** Composes the shared tutor API with native bearer authentication and fetch. */
export function makeNativeTutorApi(
  apiUrl: string,
  getAccessToken: () => Promise<string | null>,
  getAccountId: () => string | null,
) {
  const baseUrl = apiUrl.trim().replace(/\/$/, "");
  return createTutorApi((request: TutorHttpRequest) =>
    Effect.gen(function* () {
      const accountId = getAccountId();
      const reservation =
        request.method === "POST" && accountId
          ? {
              requestId: Crypto.randomUUID(),
              accountId: `hosted:${accountId}`,
              model: "hosted-provider",
              task: "tutor" as const,
              startedAt: Date.now(),
            }
          : null;
      if (request.method === "POST" && !reservation)
        return { status: 401, body: { error: "Sign in before making AI requests." } };
      if (reservation) {
        const admitted = yield* Effect.either(nativeLocalBudget.reserve(reservation));
        if (Either.isLeft(admitted)) return { status: 429, body: { error: admitted.left.message } };
      }
      const response = yield* Effect.tryPromise({
        try: async () => {
          const token = await getAccessToken();
          if (getAccountId() !== accountId)
            return { status: 401, body: { error: "The selected account changed. Try again." } };
          return await withNativeRequest(
            `${baseUrl}${request.path}`,
            {
              method: request.method,
              headers: {
                ...(token === null ? {} : { authorization: `Bearer ${token}` }),
                ...(request.body === undefined ? {} : { "content-type": "application/json" }),
              },
              ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
            },
            async (response) => {
              try {
                return { status: response.status, body: (await response.json()) as unknown };
              } catch {
                return { status: response.status, body: null };
              }
            },
          );
        },
        catch: () => ({ _tag: "TutorTransportError" }) as const,
      }).pipe(
        Effect.onError(() =>
          reservation
            ? nativeLocalBudget
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
        yield* nativeLocalBudget
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
}
