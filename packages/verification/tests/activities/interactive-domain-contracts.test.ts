import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import {
  ActivityInteractionSchema,
  ActivityResponseSchema,
  ActivityRuntimeProvenanceSchema,
  CodeTracingPayloadSchema,
  CodingExecutionSchema,
  CodingPayloadSchema,
  LuaActivityPayloadSchema,
  MatchingPayloadSchema,
  OrderingPayloadSchema,
} from "@recall/domain";

const coding = {
  prompts: ["Implement solve"],
  rubric: "Correct output",
  reference: "",
  language: "javascript",
  tests: [{ input: [1], expected: 2 }],
};

await test("legacy response and coding contracts remain valid with optional additions", () => {
  assert.ok(
    Schema.is(ActivityResponseSchema)({
      answers: [],
      selectedOptionIds: [],
      selfScore: 0,
      assistance: "none",
    }),
  );
  assert.ok(Schema.is(CodingPayloadSchema)(coding));
  assert.ok(Schema.is(CodingExecutionSchema)({ passed: 1, total: 1, failures: [] }));
  for (const language of ["javascript", "python", "rust"]) {
    assert.ok(
      Schema.is(CodingPayloadSchema)({
        ...coding,
        language,
        starterCode: "",
        signature: "solve(value)",
        constraints: ["positive"],
        hints: ["Add one"],
        exampleTests: coding.tests,
        mode: "practice",
      }),
    );
  }
  assert.ok(!Schema.is(CodingPayloadSchema)({ ...coding, language: "shell" }));
  assert.ok(!Schema.is(CodingExecutionSchema)({ passed: 2, total: 1, failures: [] }));
  assert.ok(
    !Schema.is(CodingExecutionSchema)({ passed: 0, total: 1, failures: [], runtimeMs: Infinity }),
  );
});

await test("interactive payloads reject ambiguous identities and excessive collections", () => {
  const items = [
    { id: "a", text: "First" },
    { id: "b", text: "Second" },
  ];
  const ordering = { prompt: "Order", items, explanation: "Because" };
  assert.ok(Schema.is(OrderingPayloadSchema)(ordering));
  assert.ok(Schema.is(OrderingPayloadSchema)({ ...ordering, seed: 4_294_967_295 }));
  for (const seed of [-1, 1.5, 4_294_967_296, Infinity]) {
    assert.ok(!Schema.is(OrderingPayloadSchema)({ ...ordering, seed }));
  }
  assert.ok(!Schema.is(OrderingPayloadSchema)({ ...ordering, items: [items[0], items[0]] }));
  assert.ok(!Schema.is(OrderingPayloadSchema)({ ...ordering, items: [] }));
  assert.ok(
    !Schema.is(OrderingPayloadSchema)({
      ...ordering,
      items: Array.from({ length: 21 }, (_, id) => ({ id: String(id), text: "item" })),
    }),
  );
  const matching = {
    prompt: "Match",
    pairs: [
      { id: "a", left: "A", right: "1" },
      { id: "b", left: "B", right: "2" },
    ],
    explanation: "",
  };
  assert.ok(Schema.is(MatchingPayloadSchema)(matching));
  assert.ok(
    !Schema.is(MatchingPayloadSchema)({
      ...matching,
      pairs: [matching.pairs[0], matching.pairs[0]],
    }),
  );
  assert.ok(
    Schema.is(CodeTracingPayloadSchema)({
      prompt: "Trace",
      code: "print(1)",
      language: "python",
      expectedOutput: "1",
      explanation: "",
    }),
  );
});

await test("Lua configuration and interaction metadata are bounded inert data", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const payload = { script: "return {}", configuration: {}, seed: 42 };
  assert.ok(Schema.is(LuaActivityPayloadSchema)(payload));
  for (const configuration of [cyclic, [], new Date(), { nested: "x".repeat(100_001) }]) {
    assert.ok(!Schema.is(LuaActivityPayloadSchema)({ ...payload, configuration }));
  }
  assert.ok(!Schema.is(LuaActivityPayloadSchema)({ ...payload, seed: -1 }));
  assert.ok(
    Schema.is(ActivityInteractionSchema)({
      firstTry: false,
      hints: 1,
      retries: 2,
      seed: 42,
      actions: [{ type: "choose", targetId: "a", value: { selected: true } }],
    }),
  );
  assert.ok(
    !Schema.is(ActivityInteractionSchema)({
      actions: Array.from({ length: 201 }, () => ({ type: "click" })),
    }),
  );
  assert.ok(!Schema.is(ActivityInteractionSchema)({ retries: Number.MAX_SAFE_INTEGER }));
  assert.ok(
    Schema.is(ActivityRuntimeProvenanceSchema)({
      runtime: "lua",
      runtimeVersion: "1",
      scriptVersion: "revision-2",
      seed: 42,
    }),
  );
});
