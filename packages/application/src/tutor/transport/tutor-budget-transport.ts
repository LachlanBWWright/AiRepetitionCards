import { Effect, Either } from "effect";
import type { LocalBudgetFailure } from "../../usage/local-ai-budget-service";
import type { LocalAiUsageReservation, LocalAiUsageSettlement } from "../../usage/local-ai-usage";
import type { TutorHttpRequest, TutorHttpResponse, TutorTransport } from "./tutor-api";

export type TutorBudgetDependencies = {
  readonly budget: {
    readonly reserve: (
      input: LocalAiUsageReservation,
    ) => Effect.Effect<unknown, LocalBudgetFailure>;
    readonly settle: (input: LocalAiUsageSettlement) => Effect.Effect<void, LocalBudgetFailure>;
  };
  readonly now: () => number;
  readonly createId: () => string;
};

/** Auth adapters capture an account and bind the transport to that same identity. */
export function executeBudgetedTutorRequest(
  request: TutorHttpRequest,
  accountId: string | null,
  transport: TutorTransport,
  dependencies: TutorBudgetDependencies,
): ReturnType<TutorTransport> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      if (request.method !== "POST") return yield* restore(transport(request));
      if (!accountId) return { status: 401, body: { error: "Sign in before making AI requests." } };
      const reservation: LocalAiUsageReservation = {
        requestId: dependencies.createId(),
        accountId: `hosted:${accountId}`,
        model: "hosted-provider",
        task: "tutor",
        startedAt: dependencies.now(),
      };
      const admitted = yield* Effect.either(dependencies.budget.reserve(reservation));
      if (Either.isLeft(admitted)) return { status: 429, body: { error: admitted.left.message } };
      const settle = (outcome: "completed" | "failed") =>
        dependencies.budget.settle({
          requestId: reservation.requestId,
          finishedAt: dependencies.now(),
          outcome,
          inputTokens: null,
          outputTokens: null,
        });
      const response: TutorHttpResponse = yield* restore(transport(request)).pipe(
        Effect.onExit((exit) =>
          exit._tag === "Failure" ? settle("failed").pipe(Effect.ignore) : Effect.void,
        ),
      );
      yield* settle(response.status >= 200 && response.status < 300 ? "completed" : "failed").pipe(
        Effect.mapError(() => ({ _tag: "TutorTransportError" }) as const),
      );
      return response;
    }),
  );
}
