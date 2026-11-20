import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import {
  authorLearningActivity,
  assessLearningActivity,
  presentLearningActivity,
  canonicalMatchingAnswer,
  interactiveActivityEditorFields,
  shuffleInteractiveItems,
} from "@recall/application";

const author = (pluginId: string, fields: Readonly<Record<string, string>>) =>
  Effect.runPromise(
    authorLearningActivity({
      id: "game",
      areaId: "area",
      objectiveId: "objective",
      title: "Game",
      pluginId,
      fields: { prompt: "Complete.", reference: "Explanation", ...fields },
    }),
  );
const response = { answers: [], selectedOptionIds: [], assistance: "none", selfScore: 1 } as const;
await test("ordering is deterministic, shuffled away from solution, and validates exact permutations", async () => {
  const activity = await author("recall.ordering", { items: "First\nSecond\nThird", seed: "42" });
  const first = await Effect.runPromise(presentLearningActivity(activity));
  assert.deepEqual(first, await Effect.runPromise(presentLearningActivity(activity)));
  assert.equal(first.interactive?.kind, "ordering");
  assert.equal(first.interactive.seed, 42);
  assert.notDeepEqual(
    first.interactive.items.map((item) => item.id),
    ["1", "2", "3"],
  );
  assert.equal(
    (
      await Effect.runPromise(
        assessLearningActivity(activity, { ...response, selectedOptionIds: ["1", "2", "3"] }),
      )
    ).evidence[0]?.score,
    1,
  );
  for (const ids of [
    ["1", "1", "3"],
    ["1", "2"],
    ["1", "2", "unknown"],
  ]) {
    assert.ok(
      Either.isLeft(
        await Effect.runPromise(
          Effect.either(assessLearningActivity(activity, { ...response, selectedOptionIds: ids })),
        ),
      ),
    );
  }
  assert.equal(interactiveActivityEditorFields(activity)?.items, "First\nSecond\nThird");
  for (let seed = 0; seed < 64; seed += 1) {
    const source = ["a", "b", "c"];
    const shuffled = shuffleInteractiveItems(source, seed);
    assert.notDeepEqual(shuffled, source);
    assert.deepEqual([...shuffled].sort(), source);
    assert.deepEqual(source, ["a", "b", "c"]);
  }
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(
        Effect.either(
          assessLearningActivity(activity, {
            ...response,
            selectedOptionIds: ["1", "2", "3"],
            interaction: { seed: 41 },
          }),
        ),
      ),
    ),
  );
});
await test("matching uses canonical mapping independent of presentation order and rejects non-bijections", async () => {
  const activity = await author("recall.matching", { pairs: "One | Uno\nTwo | Dos\nThree | Tres" });
  assert.equal(canonicalMatchingAnswer({ "2": "2", "1": "1" }), '{"1":"1","2":"2"}');
  const content = await Effect.runPromise(presentLearningActivity(activity));
  assert.equal(content.interactive?.kind, "matching");
  assert.notDeepEqual(
    content.interactive.left.map((item) => item.id),
    content.interactive.right.map((item) => item.id),
  );
  const answer = canonicalMatchingAnswer({ "1": "1", "2": "2", "3": "3" });
  assert.equal(
    (await Effect.runPromise(assessLearningActivity(activity, { ...response, answers: [answer] })))
      .evidence[0]?.score,
    1,
  );
  for (const answer of [
    '{"1":"1","2":"1","3":"3"}',
    '{"1":"1"}',
    '{"1":"1","2":"2","3":"unknown"}',
    "bad JSON",
  ])
    assert.ok(
      Either.isLeft(
        await Effect.runPromise(
          Effect.either(assessLearningActivity(activity, { ...response, answers: [answer] })),
        ),
      ),
    );
});
await test("code tracing compares normalized text without executing source, and preserves hint/retry context", async () => {
  const activity = await author("recall.code-tracing", {
    code: "while (true) {}",
    language: "javascript",
    expectedOutput: "Result\n  2",
  });
  const result = await Effect.runPromise(
    assessLearningActivity(activity, {
      ...response,
      answers: ["Result  \r\n  2\r\n"],
      assistance: "hint",
      interaction: { hints: 1, retries: 2, firstTry: false },
    }),
  );
  assert.equal(result.evidence[0]?.score, 1);
  assert.equal(result.evidence[0].assistance, "hint");
  assert.match(result.evidence[0].explanation, /retries: 2/);
  assert.equal(
    (
      await Effect.runPromise(
        assessLearningActivity(activity, { ...response, answers: ["result\n2"] }),
      )
    ).evidence[0]?.score,
    0,
  );
  for (const interaction of [{ hints: 1 }, { retries: 1, firstTry: true }])
    assert.ok(
      Either.isLeft(
        await Effect.runPromise(
          Effect.either(
            assessLearningActivity(activity, {
              ...response,
              answers: ["Result\n  2"],
              interaction,
            }),
          ),
        ),
      ),
    );
});
await test("authoring rejects malformed pairs and invalid seeds", async () => {
  const outcome = await Effect.runPromise(
    Effect.either(
      authorLearningActivity({
        id: "game",
        areaId: "area",
        objectiveId: "objective",
        title: "Game",
        pluginId: "recall.matching",
        fields: { prompt: "Match", pairs: "Missing separator\nA | B", seed: "1" },
      }),
    ),
  );
  assert.ok(Either.isLeft(outcome));
});

await test("authoring rejects out-of-range or noninteger seeds", async () => {
  for (const seed of ["-1", "1.5", "4294967296", "", "NaN"]) {
    assert.ok(
      Either.isLeft(
        await Effect.runPromise(
          Effect.either(
            authorLearningActivity({
              id: "game",
              areaId: "area",
              objectiveId: "objective",
              title: "Game",
              pluginId: "recall.ordering",
              fields: { prompt: "Order", items: "A\nB", seed },
            }),
          ),
        ),
      ),
    );
  }
});
