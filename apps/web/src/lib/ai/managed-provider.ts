import "server-only";
import { Effect, Either, Schema } from "effect";
import type { AiOperation, AiProviderService, AiProviderError } from "@recall/ai-core";
import {
  createOpenAiProvider,
  createAnthropicProvider,
  type OpenAiProviderConfiguration,
} from "@recall/infra-openai";
import type { managedAiRpc } from "./managed-rpc";

const Plan = Schema.Struct({
  allowed: Schema.Literal(true),
  deploymentId: Schema.String,
  providerId: Schema.Literal("openai", "anthropic"),
  model: Schema.String,
  pricingVersion: Schema.String,
  maxInputBytes: Schema.Number,
  maxOutputTokens: Schema.Number,
});
const Admitted = Schema.Struct({ allowed: Schema.Literal(true) });
const unavailable: AiProviderError = { _tag: "AiBudgetUnavailable" };
const denied = (raw: unknown): AiProviderError => {
  const reason = Schema.decodeUnknownEither(Schema.Struct({ reason: Schema.String }))(raw);
  if (Either.isLeft(reason)) return unavailable;
  switch (reason.right.reason) {
    case "managed-disabled":
    case "managed-not-entitled":
      return { _tag: "AiManagedAccessDenied" };
    case "managed-budget-exceeded":
      return { _tag: "AiBudgetExceeded" };
    case "managed-concurrency-limit":
      return { _tag: "AiRateLimited" };
    case "request-too-large":
      return { _tag: "AiContextBudgetExceeded" };
    case "route-unavailable":
    case "route-changed":
      return { _tag: "AiProviderUnavailable" };
    default:
      return unavailable;
  }
};

/** One provider instance dispatches one admitted call. No automatic retry or funding fallback. */
export type ManagedProviderPorts = {
  readonly enabled: boolean;
  readonly rpc: typeof managedAiRpc;
  readonly credentials: Readonly<Record<"openai" | "anthropic", string | undefined>>;
  readonly fetch?: typeof fetch;
};
export function createManagedTutorProvider(
  userId: string,
  callId: string,
  ports: ManagedProviderPorts,
): AiProviderService {
  let started = false;
  function invoke<A>(
    operation: AiOperation,
    run: (provider: AiProviderService) => Effect.Effect<A, AiProviderError>,
  ) {
    return Effect.gen(function* () {
      if (!ports.enabled) return yield* Effect.fail(unavailable);
      if (started) return yield* Effect.fail(unavailable);
      started = true;
      const raw = yield* ports.rpc("managed_ai_plan", {
        p_user_id: userId,
        p_operation: operation,
      });
      const plan = Schema.decodeUnknownEither(Plan)(raw);
      if (Either.isLeft(plan)) return yield* Effect.fail(denied(raw));
      const deployment = plan.right;
      const apiKey = ports.credentials[deployment.providerId];
      if (!apiKey?.trim()) return yield* Effect.fail({ _tag: "AiProviderUnavailable" } as const);
      let admitted = false;
      const configuration: OpenAiProviderConfiguration = {
        apiKey,
        ...(ports.fetch ? { fetch: ports.fetch } : {}),
        model: deployment.model,
        onRequestPrepared: (request) =>
          Effect.gen(function* () {
            if (
              request.requestBytes > deployment.maxInputBytes ||
              request.maxOutputTokens > deployment.maxOutputTokens
            )
              return yield* Effect.fail({ _tag: "AiContextBudgetExceeded" } as const);
            const admission = yield* ports.rpc("managed_ai_reserve", {
              p_user_id: userId,
              p_call_id: callId,
              p_operation: operation,
              p_deployment_id: deployment.deploymentId,
              p_model: deployment.model,
              p_pricing_version: deployment.pricingVersion,
              p_input_bytes: request.requestBytes,
              p_output_tokens: request.maxOutputTokens,
            });
            if (Either.isLeft(Schema.decodeUnknownEither(Admitted)(admission)))
              return yield* Effect.fail(denied(admission));
            admitted = true;
          }),
        onUsageRecorded: (usage) =>
          ports
            .rpc("managed_ai_settle", {
              p_user_id: userId,
              p_call_id: callId,
              p_input_tokens: usage.inputTokens,
              p_output_tokens: usage.outputTokens,
              p_returned_model: usage.returnedModel ?? null,
            })
            .pipe(
              Effect.flatMap((settled) =>
                settled === true ? Effect.void : Effect.fail(unavailable),
              ),
            ),
      };
      const provider =
        deployment.providerId === "openai"
          ? createOpenAiProvider(configuration)
          : createAnthropicProvider(configuration);
      const retainUnknownUsage = () =>
        ports
          .rpc("managed_ai_settle", {
            p_user_id: userId,
            p_call_id: callId,
            p_input_tokens: null,
            p_output_tokens: null,
          })
          .pipe(Effect.ignore);
      return yield* run(provider).pipe(
        Effect.onError(() => (admitted ? retainUnknownUsage() : Effect.void)),
      );
    });
  }
  const optional = <A>(effect: Effect.Effect<A, AiProviderError> | undefined) =>
    effect ?? Effect.fail({ _tag: "AiProviderUnavailable" } as const);
  return {
    capabilities: {
      supportedOperations: [
        "question",
        "evaluate",
        "propose-card",
        "targeted-quiz",
        "refine-card",
        "inspect-card",
        "study-card",
        "plan-study",
      ],
      structuredOutputs: true,
      streaming: false,
      maxInputBytes: 96000,
      maxOutputTokens: 2600,
    },
    generateQuestion: (context) => invoke("question", (p) => p.generateQuestion(context)),
    evaluateAnswer: (context) => invoke("evaluate", (p) => p.evaluateAnswer(context)),
    proposeCard: (context) => invoke("propose-card", (p) => p.proposeCard(context)),
    generateTargetedQuiz: (context) =>
      invoke("targeted-quiz", (p) => p.generateTargetedQuiz(context)),
    refineCard: (context) => invoke("refine-card", (p) => optional(p.refineCard?.(context))),
    inspectCard: (context) => invoke("inspect-card", (p) => optional(p.inspectCard?.(context))),
    generateStudyCard: (context) =>
      invoke("study-card", (p) => optional(p.generateStudyCard?.(context))),
    planStudy: (context) => invoke("plan-study", (p) => optional(p.planStudy?.(context))),
  };
}
