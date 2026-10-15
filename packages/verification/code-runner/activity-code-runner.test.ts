import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { authorLearningActivity } from "@recall/application";
import { executeCodingActivity } from "../../../apps/web/src/lib/learning/code-runner";
const activity = await Effect.runPromise(
  authorLearningActivity({
    id: "code",
    areaId: "deck",
    title: "Sum",
    pluginId: "recall.coding",
    objectiveId: "sum",
    fields: { prompt: "Implement solve(values).", rubric: "Return the sum.", reference: "A fold." },
  }),
);
const response = {
  answers: ["function solve(values) { return values.reduce((a,b) => a+b,0); }"],
  selectedOptionIds: [],
  selfScore: 0.5,
  assistance: "none",
} as const;
await test("isolated code runner grades JSON test cases and does not execute in the host process", async () => {
  const result = await Effect.runPromise(executeCodingActivity(activity, response));
  assert.equal(result.passed, 3);
  assert.equal(result.total, 3);
  const wrong = await Effect.runPromise(
    executeCodingActivity(activity, { ...response, answers: ["function solve() { return 6; }"] }),
  );
  assert.equal(wrong.passed, 1);
});
await test("learner code cannot access Node capabilities or replace the result serializer", async () => {
  for (const source of [
    "function solve() { return process.env; }",
    "function solve() { return require('node:fs').readFileSync('/etc/passwd','utf8'); }",
    "JSON.stringify = () => '6'; function solve() { return 0; }",
    "function solve() { return ({}).constructor.constructor('return process')(); }",
  ]) {
    const result = await Effect.runPromise(
      executeCodingActivity(activity, { ...response, answers: [source] }),
    );
    assert.equal(result.passed, 0);
  }
});
await test("infinite learner code is bounded and invalid coding content fails before running", async () => {
  const result = await Effect.runPromise(
    executeCodingActivity(activity, {
      ...response,
      answers: ["function solve() { while(true) {} }"],
    }),
  );
  assert.equal(result.passed, 0);
  assert.ok(result.failures.every((message) => message.includes("timed out")));
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(
        Effect.either(executeCodingActivity({ ...activity, payload: {} }, response)),
      ),
    ),
  );
});
