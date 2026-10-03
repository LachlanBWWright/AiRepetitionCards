import "server-only";

import { Effect, Either, Schema } from "effect";
import type { AiOperation, AiProviderService } from "@recall/ai-core";
import { AccountIdSchema } from "@recall/domain";
import {
  reserveAiUsage,
  settleAiUsage,
  type AiUsageReservation,
  type AiUsageBudgetFailure,
} from "@recall/application";
import { readHostedAiBudgetConfiguration, createHostedAiUsageBudget } from "./usage-budget";
import { createOpenAiProvider, resolveOpenAiModel } from "@recall/infra-openai";

const configuration = {
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
  taskModels: {
    tutor: process.env.OPENAI_TUTOR_MODEL,
    evaluation: process.env.OPENAI_EVALUATION_MODEL,
    proposal: process.env.OPENAI_PROPOSAL_MODEL,
  },
};

/** Each HTTP call receives its own authenticated budget admission and reservation. */
export function createHostedTutorProvider(
  userId: string,
  aiCallId: string,
  now: Date,
): Either.Either<AiProviderService, AiUsageBudgetFailure> {
  const configured = readHostedAiBudgetConfiguration();
  if (Either.isLeft(configured)) return Either.left(configured.left);
  if (configured.right === null) return Either.right(createOpenAiProvider(configuration));
  const owner = Schema.decodeUnknownEither(AccountIdSchema)(userId);
  const operationId = Schema.decodeUnknownEither(AccountIdSchema)(aiCallId);
  if (Either.isLeft(owner) || Either.isLeft(operationId) || !Number.isFinite(now.getTime()))
    return Either.left({ _tag: "AiBudgetUnavailable" });
  const day = now.toISOString().slice(0, 10);
  const budget = createHostedAiUsageBudget(configured.right, owner.right, operationId.right, now);
  let reservation: AiUsageReservation | null = null;
  let admissionStarted = false;
  return Either.right(
    createOpenAiProvider({
      ...configuration,
      onRequestPrepared: (request) =>
        Effect.suspend(() => {
          // A provider instance can dispatch only one billable call for this operation identity.
          if (admissionStarted) return Effect.fail({ _tag: "AiBudgetUnavailable" } as const);
          admissionStarted = true;
          return reserveAiUsage(budget, {
            ...request,
            userId: owner.right,
            operationId: operationId.right,
            day,
          }).pipe(
            Effect.tap((hold) =>
              Effect.sync(() => {
                reservation = hold;
              }),
            ),
            Effect.asVoid,
          );
        }),
      onUsageRecorded: (usage) =>
        Effect.suspend(() =>
          reservation === null
            ? Effect.fail({ _tag: "AiBudgetUnavailable" } as const)
            : settleAiUsage(budget, { reservation, ...usage }),
        ),
    }),
  );
}

export function hostedTutorModel(operation: AiOperation): string | null {
  return resolveOpenAiModel(configuration, operation);
}
