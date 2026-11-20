import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import type { LearningActivity } from "@recall/domain";
import { assessLearningActivity, presentLearningActivity } from "@recall/application";

const base = {
  id: "interactive",
  areaId: "deck",
  title: "Interactive",
  revision: 1,
  pluginVersion: 1,
  objectiveIds: ["objective"],
  fallback: "Read the explanation",
};
const response = {
  answers: [],
  selectedOptionIds: [],
  selfScore: 0.5,
  assistance: "none",
} as const;
const ordering: LearningActivity = {
  ...base,
  pluginId: "recall.ordering",
  payload: {
    prompt: "Order",
    items: [
      { id: "a", text: "First" },
      { id: "b", text: "Second" },
    ],
    explanation: "a before b",
    seed: 1,
  },
};
const matching: LearningActivity = {
  ...base,
  pluginId: "recall.matching",
  payload: {
    prompt: "Match",
    pairs: [
      { id: "a", left: "A", right: "One" },
      { id: "b", left: "B", right: "Two" },
    ],
    explanation: "A is one",
    seed: 1,
  },
};

await test("ordering presentation never starts at the authored answer; malformed permutations fail", async () => {
  const first = await Effect.runPromise(presentLearningActivity(ordering));
  assert.deepEqual(await Effect.runPromise(presentLearningActivity(ordering)), first);
  assert.equal(first.interactive?.kind, "ordering");
  assert.notDeepEqual(
    first.interactive.items.map((item) => item.id),
    ["a", "b"],
  );
  for (const ids of [["a"], ["a", "a"], ["a", "unknown"]]) {
    assert.ok(
      Either.isLeft(
        await Effect.runPromise(
          Effect.either(assessLearningActivity(ordering, { ...response, selectedOptionIds: ids })),
        ),
      ),
    );
  }
  const correct = await Effect.runPromise(
    assessLearningActivity(ordering, { ...response, selectedOptionIds: ["a", "b"] }),
  );
  assert.equal(correct.evidence[0]?.score, 1);
});

await test("matching assesses canonical ID mappings independently of JSON key order and rejects non-bijections", async () => {
  for (const answer of ['{"a":"a","b":"b"}', '{"b":"b","a":"a"}']) {
    const correct = await Effect.runPromise(
      assessLearningActivity(matching, { ...response, answers: [answer] }),
    );
    assert.equal(correct.evidence[0]?.score, 1);
  }
  for (const answer of ['{"a":"a","b":"a"}', '{"a":"a"}', '{"a":"a","b":"unknown"}', "null"])
    assert.ok(
      Either.isLeft(
        await Effect.runPromise(
          Effect.either(assessLearningActivity(matching, { ...response, answers: [answer] })),
        ),
      ),
    );
});

await test("code tracing compares normalized text and never executes the supplied source", async () => {
  const tracing: LearningActivity = {
    ...base,
    pluginId: "recall.code-tracing",
    payload: {
      prompt: "Trace",
      code: "while (true) {}",
      language: "javascript",
      expectedOutput: "  A\nB",
      explanation: "Text comparison",
    },
  };
  const correct = await Effect.runPromise(
    assessLearningActivity(tracing, { ...response, answers: ["  A  \r\nB\n"] }),
  );
  assert.equal(correct.evidence[0]?.score, 1);
  const wrong = await Effect.runPromise(
    assessLearningActivity(tracing, { ...response, answers: ["A\nB"] }),
  );
  assert.equal(wrong.evidence[0]?.score, 0);
});
