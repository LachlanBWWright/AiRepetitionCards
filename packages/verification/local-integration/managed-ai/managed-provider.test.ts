import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { toKnowledgeArea } from "@recall/application";
import {
  createManagedTutorProvider,
  type ManagedProviderPorts,
} from "../../../../apps/web/src/lib/ai/managed-provider";
import { workspace, uuid } from "../../tests/workspace/workspace-sync-fixtures";
const area = workspace([]).areas[0];
assert.ok(area);
const context = { knowledgeArea: Effect.runSync(toKnowledgeArea(area, true, true)), history: [] };
const answer = {
  question: "Why do cells need membranes?",
  objectiveId: null,
  teachingIntent: "Check reasoning",
};
function fixture(
  options: {
    readonly providerId?: "openai" | "anthropic";
    readonly deny?: string;
    readonly malformed?: boolean;
    readonly unknownUsage?: boolean;
    readonly unavailable?: boolean;
    readonly settlementFailure?: boolean;
    readonly tooLong?: boolean;
  } = {},
) {
  const calls: { readonly name: string; readonly body: Readonly<Record<string, unknown>> }[] = [];
  const providerId = options.providerId ?? "anthropic";
  let networkCalls = 0;
  const ports: ManagedProviderPorts = {
    enabled: true,
    credentials: { openai: "fixture-key", anthropic: "fixture-key" },
    rpc: (name, body) => {
      calls.push({ name, body });
      if (name === "managed_ai_plan")
        return Effect.succeed({
          allowed: true,
          deploymentId: "test",
          providerId,
          model: "fixture-model",
          pricingVersion: "v1",
          maxInputBytes: 96000,
          maxOutputTokens: 2600,
        });
      if (name === "managed_ai_reserve")
        return Effect.succeed(
          options.deny ? { allowed: false, reason: options.deny } : { allowed: true },
        );
      return Effect.succeed(!options.settlementFailure);
    },
    fetch: (url, init) => {
      networkCalls++;
      assert.equal(
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
        providerId === "anthropic"
          ? "https://api.anthropic.com/v1/messages"
          : "https://api.openai.com/v1/responses",
      );
      assert.equal(typeof init?.body, "string");
      const request: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "null");
      assert.equal(typeof request, "object");
      const text = JSON.stringify(
        options.malformed
          ? { invalid: true }
          : options.tooLong
            ? { ...answer, question: "x".repeat(2001) }
            : answer,
      );
      if (options.unavailable) return Promise.resolve(new Response("unavailable", { status: 503 }));
      const usage = { input_tokens: 80, output_tokens: 20, cache_read_input_tokens: 10 };
      const anthropic = {
        model: "provider-model-version",
        stop_reason: "end_turn",
        content: [{ type: "text", text }],
        ...(options.unknownUsage ? {} : { usage }),
      };
      const openai = {
        model: "provider-model-version",
        status: "completed",
        output: [{ content: [{ type: "output_text", text }] }],
        ...(options.unknownUsage ? {} : { usage: { input_tokens: 90, output_tokens: 20 } }),
      };
      return Promise.resolve(Response.json(providerId === "anthropic" ? anthropic : openai));
    },
  };
  return {
    calls,
    ports,
    networkCalls: () => networkCalls,
    provider: createManagedTutorProvider(uuid(7), uuid(800), ports),
  };
}
for (const providerId of ["openai", "anthropic"] as const) {
  await test(`managed ${providerId} reserves before generation and settles provider usage`, async () => {
    const run = fixture({ providerId });
    const result = await Effect.runPromise(run.provider.generateQuestion(context));
    assert.deepEqual(result.result, answer);
    assert.deepEqual(
      run.calls.map((call) => call.name),
      ["managed_ai_plan", "managed_ai_reserve", "managed_ai_settle"],
    );
    const admission = run.calls[1];
    const settlement = run.calls[2];
    assert.ok(admission);
    assert.ok(settlement);
    assert.equal(admission.body.p_deployment_id, "test");
    assert.equal(admission.body.p_pricing_version, "v1");
    assert.equal(settlement.body.p_input_tokens, 90);
    assert.equal(settlement.body.p_output_tokens, 20);
    assert.equal(settlement.body.p_returned_model, "provider-model-version");
    assert.ok(
      Either.isLeft(await Effect.runPromise(Effect.either(run.provider.generateQuestion(context)))),
    );
    assert.equal(run.networkCalls(), 1);
  });
}
await test("budget rejection cannot dispatch a paid call or settle an unreserved request", async () => {
  const run = fixture({ deny: "managed-budget-exceeded" });
  const result = await Effect.runPromise(Effect.either(run.provider.generateQuestion(context)));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left._tag, "AiBudgetExceeded");
  assert.equal(run.networkCalls(), 0);
  assert.deepEqual(
    run.calls.map((call) => call.name),
    ["managed_ai_plan", "managed_ai_reserve"],
  );
});
await test("invalid generated content is charged before application validation fails", async () => {
  const run = fixture({ malformed: true });
  assert.ok(
    Either.isLeft(await Effect.runPromise(Effect.either(run.provider.generateQuestion(context)))),
  );
  assert.ok(
    run.calls.some((call) => call.name === "managed_ai_settle" && call.body.p_input_tokens === 90),
  );
});
await test("ambiguous provider failures retain an unknown-usage hold without retrying another provider", async () => {
  const run = fixture({ unavailable: true });
  assert.ok(
    Either.isLeft(await Effect.runPromise(Effect.either(run.provider.generateQuestion(context)))),
  );
  assert.equal(run.networkCalls(), 1);
  assert.ok(
    run.calls.some(
      (call) => call.name === "managed_ai_settle" && call.body.p_input_tokens === null,
    ),
  );
});
await test("missing usage never becomes a zero-token refund", async () => {
  const run = fixture({ unknownUsage: true });
  await Effect.runPromise(run.provider.generateQuestion(context));
  assert.equal(run.calls.at(-1)?.body.p_input_tokens, null);
  assert.equal(run.calls.at(-1)?.body.p_output_tokens, null);
});
await test("settlement failure prevents accepting an unaccounted response", async () => {
  const run = fixture({ settlementFailure: true });
  assert.ok(
    Either.isLeft(await Effect.runPromise(Effect.either(run.provider.generateQuestion(context)))),
  );
});
await test("disabled managed access and absent credentials fail before reservation", async () => {
  const run = fixture();
  for (const ports of [
    { ...run.ports, enabled: false },
    { ...run.ports, credentials: { openai: undefined, anthropic: undefined } },
  ]) {
    assert.ok(
      Either.isLeft(
        await Effect.runPromise(
          Effect.either(
            createManagedTutorProvider(uuid(7), uuid(801), ports).generateQuestion(context),
          ),
        ),
      ),
    );
  }
  assert.equal(run.networkCalls(), 0);
  assert.ok(run.calls.every((call) => call.name === "managed_ai_plan"));
});

await test("Anthropic schema projection keeps the original application constraints enforced", async () => {
  const run = fixture({ tooLong: true });
  const result = await Effect.runPromise(Effect.either(run.provider.generateQuestion(context)));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left._tag, "AiStructuredOutputError");
  assert.ok(
    run.calls.some((call) => call.name === "managed_ai_settle" && call.body.p_input_tokens === 90),
  );
});
