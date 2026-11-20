import { Effect, Schema } from "effect";
import { AiOperationSchema, AiProviderCapabilitiesSchema } from "@recall/ai-core";
import type { AiAccessDecision } from "./ai-access";

const Identifier = Schema.String.pipe(Schema.pattern(/^[a-z][a-z0-9-]{0,63}$/));
const PositiveInteger = Schema.Number.pipe(Schema.int(), Schema.positive());
export const ManagedAiRoutingSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  deployments: Schema.Array(
    Schema.Struct({
      id: Identifier,
      providerId: Identifier,
      model: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/)),
      enabled: Schema.Boolean,
      capabilities: AiProviderCapabilitiesSchema,
    }),
  ).pipe(Schema.minItems(1), Schema.maxItems(100)),
  routes: Schema.Array(
    Schema.Struct({ operation: AiOperationSchema, deploymentId: Identifier }),
  ).pipe(Schema.minItems(1), Schema.maxItems(8)),
});
const RequestSchema = Schema.Struct({
  operation: AiOperationSchema,
  inputBytes: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  maximumOutputTokens: PositiveInteger,
});
export type ManagedAiRoute = {
  readonly deploymentId: string;
  readonly providerId: string;
  readonly model: string;
  readonly operation: typeof AiOperationSchema.Type;
  readonly maximumOutputTokens: number;
};
export type ManagedAiRoutingFailure = {
  readonly _tag: "ManagedAiRoutingFailure";
  readonly reason:
    | "invalid-configuration"
    | "invalid-request"
    | "managed-selection-required"
    | "route-unavailable"
    | "deployment-not-entitled"
    | "unsupported-operation"
    | "context-too-large"
    | "output-budget-exceeded";
};
const failure = (reason: ManagedAiRoutingFailure["reason"]): ManagedAiRoutingFailure => ({
  _tag: "ManagedAiRoutingFailure",
  reason,
});

/** Server-owned deterministic routing. No retries, provider calls, budget charges or fallback. */
export function resolveManagedAiRoute(
  configuration: unknown,
  input: unknown,
  access: AiAccessDecision,
): Effect.Effect<ManagedAiRoute, ManagedAiRoutingFailure> {
  return Effect.gen(function* () {
    if (access.mode !== "managed") return yield* Effect.fail(failure("managed-selection-required"));
    const catalog = yield* Schema.decodeUnknown(ManagedAiRoutingSchema)(configuration).pipe(
      Effect.mapError(() => failure("invalid-configuration")),
    );
    const request = yield* Schema.decodeUnknown(RequestSchema)(input).pipe(
      Effect.mapError(() => failure("invalid-request")),
    );
    if (
      new Set(catalog.deployments.map((item) => item.id)).size !== catalog.deployments.length ||
      new Set(catalog.routes.map((item) => item.operation)).size !== catalog.routes.length ||
      catalog.routes.some(
        (route) => !catalog.deployments.some((item) => item.id === route.deploymentId),
      ) ||
      catalog.deployments.some(
        ({ capabilities }) =>
          new Set(capabilities.supportedOperations).size !==
          capabilities.supportedOperations.length,
      )
    )
      return yield* Effect.fail(failure("invalid-configuration"));
    const route = catalog.routes.find((item) => item.operation === request.operation);
    const deployment = catalog.deployments.find((item) => item.id === route?.deploymentId);
    if (!deployment?.enabled) return yield* Effect.fail(failure("route-unavailable"));
    if (!access.deploymentIds.includes(deployment.id))
      return yield* Effect.fail(failure("deployment-not-entitled"));
    const capabilities = deployment.capabilities;
    if (
      !capabilities.structuredOutputs ||
      !capabilities.supportedOperations.includes(request.operation) ||
      capabilities.maxOutputTokens === null
    )
      return yield* Effect.fail(failure("unsupported-operation"));
    if (request.inputBytes > capabilities.maxInputBytes)
      return yield* Effect.fail(failure("context-too-large"));
    if (request.maximumOutputTokens > capabilities.maxOutputTokens)
      return yield* Effect.fail(failure("output-budget-exceeded"));
    return {
      deploymentId: deployment.id,
      providerId: deployment.providerId,
      model: deployment.model,
      operation: request.operation,
      maximumOutputTokens: request.maximumOutputTokens,
    };
  });
}
