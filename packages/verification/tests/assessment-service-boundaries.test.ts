import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import {
  authorLearningActivity,
  assessLearningActivity,
  createActivityServices,
} from "@recall/application";
const activity = await Effect.runPromise(
  authorLearningActivity({
    id: "boundary-activity",
    areaId: "deck",
    title: "Question",
    pluginId: "recall.multiple-choice",
    objectiveId: "objective",
    fields: { prompt: "Choose.", options: "Yes\nNo", correct: "1", reference: "Yes." },
  }),
);
const response = {
  answers: [],
  selectedOptionIds: ["1"],
  selfScore: 0.5,
  assistance: "none",
} as const;
const result = await Effect.runPromise(assessLearningActivity(activity, response));
await test("HTTP assessment rejects evidence for other objectives, mismatched assistance, and duplicate dimensions", async () => {
  const entry = result.evidence[0];
  assert.ok(entry);
  for (const evidence of [
    [{ ...entry, objectiveId: "unrelated-objective" }],
    [{ ...entry, assistance: "hint" }],
    [entry, entry],
  ]) {
    const services = createActivityServices(() =>
      Effect.succeed({ status: 200, body: { ...result, evidence } }),
    );
    const reply = await Effect.runPromise(Effect.either(services.assess(activity, response)));
    assert.ok(Either.isLeft(reply));
    assert.equal(reply.left.reason, "assessment-unavailable");
  }
  const services = createActivityServices(() => Effect.succeed({ status: 200, body: result }));
  assert.deepEqual(await Effect.runPromise(services.assess(activity, response)), result);
});
await test("HTTP learning services preserve actionable expected failures and reject oversized questions", async () => {
  const services = createActivityServices(() =>
    Effect.succeed({ status: 422, body: { error: "The rubric is inconclusive." } }),
  );
  const reply = await Effect.runPromise(Effect.either(services.assess(activity, response)));
  assert.ok(Either.isLeft(reply));
  assert.equal(reply.left.reason, "invalid-input");
  assert.equal(reply.left.message, "The rubric is inconclusive.");
  const oversized = createActivityServices(() =>
    Effect.succeed({ status: 200, body: { question: "x".repeat(2001) } }),
  );
  assert.ok(
    Either.isLeft(await Effect.runPromise(Effect.either(oversized.question(activity, response)))),
  );
});
