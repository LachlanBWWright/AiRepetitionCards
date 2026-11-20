import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { resolveAiAccess, resolveManagedAiRoute } from "@recall/application";
import type { AiOperation } from "@recall/ai-core";

const accountId = "00000000-0000-4000-8000-000000000001";
const otherAccountId = "00000000-0000-4000-8000-000000000002";
const state = {
  accountId,
  byoReady: true,
  now: 100,
  managedGrant: { accountId, expiresAt: 200, deploymentIds: ["primary", "secondary"] },
};
const managed = Effect.runSync(resolveAiAccess("managed", state));
const capabilities = {
  supportedOperations: ["question", "evaluate"] as const,
  structuredOutputs: true,
  streaming: false,
  maxInputBytes: 96000,
  maxOutputTokens: 2600,
};
const primary = {
  id: "primary",
  providerId: "provider-one",
  model: "model-one",
  enabled: true,
  capabilities,
};
const secondary = { ...primary, id: "secondary", providerId: "provider-two", model: "model-two" };
const configuration = {
  schemaVersion: 1,
  deployments: [primary, secondary],
  routes: [
    { operation: "question", deploymentId: "primary" },
    { operation: "evaluate", deploymentId: "secondary" },
  ],
};
const request = { operation: "question", inputBytes: 96000, maximumOutputTokens: 2600 };
function reason<A, E extends { readonly reason: string }>(effect: Effect.Effect<A, E>) {
  const result = Effect.runSync(Effect.either(effect));
  assert.ok(Either.isLeft(result));
  return result.left.reason;
}

await test("BYO remains available offline without a Recall account or managed grant", () => {
  assert.deepEqual(
    Effect.runSync(resolveAiAccess("byo", { ...state, accountId: null, managedGrant: null })),
    { mode: "byo" },
  );
});
await test("funding requires an explicit choice and never silently falls back", () => {
  assert.equal(reason(resolveAiAccess(undefined, state)), "selection-required");
  assert.equal(reason(resolveAiAccess("byo", { ...state, byoReady: false })), "byo-unavailable");
  assert.equal(
    reason(resolveAiAccess("managed", { ...state, managedGrant: null })),
    "managed-not-entitled",
  );
});
await test("managed access checks verified identity, ownership, expiration and grant validity", () => {
  assert.equal(
    reason(resolveAiAccess("managed", { ...state, accountId: null })),
    "sign-in-required",
  );
  for (const managedGrant of [
    { ...state.managedGrant, accountId: otherAccountId },
    { ...state.managedGrant, expiresAt: state.now },
    { ...state.managedGrant, deploymentIds: ["primary", "primary"] },
  ])
    assert.equal(
      reason(resolveAiAccess("managed", { ...state, managedGrant })),
      "managed-not-entitled",
    );
  assert.equal(reason(resolveAiAccess("managed", { ...state, now: NaN })), "invalid-access-state");
});
await test("server routes operations to distinct providers and models deterministically", () => {
  for (const [operation, deployment] of [
    ["question", primary],
    ["evaluate", secondary],
  ] as const) {
    assert.deepEqual(
      Effect.runSync(resolveManagedAiRoute(configuration, { ...request, operation }, managed)),
      {
        deploymentId: deployment.id,
        providerId: deployment.providerId,
        model: deployment.model,
        operation,
        maximumOutputTokens: 2600,
      },
    );
  }
});
await test("disabled or missing routes do not use another configured provider", () => {
  assert.equal(
    reason(
      resolveManagedAiRoute(
        { ...configuration, deployments: [{ ...primary, enabled: false }, secondary] },
        request,
        managed,
      ),
    ),
    "route-unavailable",
  );
  assert.equal(
    reason(resolveManagedAiRoute(configuration, { ...request, operation: "split" }, managed)),
    "invalid-request",
  );
  assert.equal(
    reason(
      resolveManagedAiRoute(configuration, { ...request, operation: "inspect-card" }, managed),
    ),
    "route-unavailable",
  );
});
await test("managed routing enforces selection and per-account deployment access", () => {
  assert.equal(
    reason(resolveManagedAiRoute(configuration, request, { mode: "byo" })),
    "managed-selection-required",
  );
  assert.equal(
    reason(
      resolveManagedAiRoute(configuration, request, {
        mode: "managed",
        accountId,
        deploymentIds: ["secondary"],
      }),
    ),
    "deployment-not-entitled",
  );
});
await test("ambiguous or dangling server configuration fails closed", () => {
  for (const invalid of [
    { ...configuration, schemaVersion: 2 },
    { ...configuration, deployments: [primary, primary] },
    { ...configuration, routes: [configuration.routes[0], configuration.routes[0]] },
    { ...configuration, routes: [{ operation: "question", deploymentId: "missing" }] },
    {
      ...configuration,
      deployments: [{ ...primary, model: "https://unexpected host" }, secondary],
    },
  ])
    assert.equal(reason(resolveManagedAiRoute(invalid, request, managed)), "invalid-configuration");
});
await test("structured output, supported operations and an enforceable output ceiling are required", () => {
  for (const unsupported of [
    { ...capabilities, structuredOutputs: false },
    { ...capabilities, maxOutputTokens: null },
    { ...capabilities, supportedOperations: ["evaluate"] satisfies AiOperation[] },
  ])
    assert.equal(
      reason(
        resolveManagedAiRoute(
          { ...configuration, deployments: [{ ...primary, capabilities: unsupported }, secondary] },
          request,
          managed,
        ),
      ),
      "unsupported-operation",
    );
});
await test("routing rejects oversized requests before admission or provider dispatch", () => {
  assert.equal(
    reason(resolveManagedAiRoute(configuration, { ...request, inputBytes: 96001 }, managed)),
    "context-too-large",
  );
  assert.equal(
    reason(
      resolveManagedAiRoute(configuration, { ...request, maximumOutputTokens: 2601 }, managed),
    ),
    "output-budget-exceeded",
  );
  assert.equal(
    reason(resolveManagedAiRoute(configuration, { ...request, inputBytes: -1 }, managed)),
    "invalid-request",
  );
});
