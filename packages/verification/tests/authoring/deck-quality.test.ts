import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { inspectDeckQuality } from "@recall/application";

const area = {
  schemaVersion: "1.0.0",
  id: "area",
  title: "Queues",
  description: null,
  language: "en",
  objectives: [{ id: "queue", title: "Understand queues", description: null, prerequisiteIds: [] }],
  ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
  cards: [
    {
      kind: "basic",
      id: "one",
      front: "What is FIFO?",
      back: "First in, first out.",
      objectiveIds: [],
      tags: [],
      origin: "authored",
    },
    {
      kind: "basic",
      id: "two",
      front: "What is FIFO?",
      back: "First in, first out.",
      objectiveIds: ["queue"],
      tags: [],
      origin: "authored",
    },
  ],
  tags: [],
  licence: null,
  activities: [],
};

await test("deck quality reports duplicates and missing objectives without implying mastery", async () => {
  const result = await Effect.runPromise(Effect.either(inspectDeckQuality(area)));
  assert.ok(Either.isRight(result));
  assert.deepEqual(
    result.right.map((issue) => issue.code),
    ["missing-objective", "duplicate-card"],
  );
  assert.equal(
    result.right.some((issue) => issue.severity === "blocking"),
    false,
  );
});

await test("deck quality distinguishes invalid media references from unavailable bytes", async () => {
  const deck = {
    ...area,
    cards: [
      { ...area.cards[0], media: [{ id: "broken-id", mimeType: "image/png", byteLength: 12 }] },
    ],
  };
  const result = await Effect.runPromise(Effect.either(inspectDeckQuality(deck)));
  assert.ok(Either.isRight(result));
  assert.equal(result.right[0]?.code, "invalid-media-reference");
  const unavailable = await Effect.runPromise(
    Effect.either(
      inspectDeckQuality(
        {
          ...area,
          cards: [
            {
              ...area.cards[0],
              media: [{ id: "a".repeat(64), mimeType: "image/png", byteLength: 12 }],
            },
          ],
        },
        { availableMediaIds: [] },
      ),
    ),
  );
  assert.ok(Either.isRight(unavailable));
  assert.equal(unavailable.right[0]?.code, "unavailable-media-bytes");
});

await test("deck quality flags unclear choices, missing answers, and weak coding tests", async () => {
  const deck = {
    ...area,
    cards: [],
    activities: [
      {
        id: "choice",
        areaId: "area",
        title: "Choose a queue",
        pluginId: "recall.multiple-choice",
        pluginVersion: 1,
        revision: 1,
        objectiveIds: ["queue"],
        fallback: "Choose the queue.",
        payload: {
          prompt: "Which structure is FIFO?",
          options: [
            { id: "a", text: "Queue" },
            { id: "b", text: " queue " },
          ],
          correctOptionIds: ["missing"],
          explanation: "A queue is FIFO.",
        },
      },
      {
        id: "code",
        areaId: "area",
        title: "Write a function",
        pluginId: "recall.coding",
        pluginVersion: 1,
        revision: 1,
        objectiveIds: ["queue"],
        fallback: "Write a function.",
        payload: {
          prompts: ["Write enqueue."],
          rubric: "Returns the queue.",
          reference: "",
          language: "javascript",
          tests: [
            { input: [[1]], expected: 1 },
            { input: [[1]], expected: 1 },
          ],
        },
      },
    ],
  };
  const result = await Effect.runPromise(Effect.either(inspectDeckQuality(deck)));
  assert.ok(Either.isRight(result));
  assert.deepEqual(
    result.right.map((issue) => issue.code),
    ["invalid-activity-payload", "ambiguous-choice", "invalid-correct-answer", "duplicate-test"],
  );
});

await test("deck quality blocks malformed payloads for known built-in activities", async () => {
  const deck = {
    ...area,
    cards: [],
    activities: [
      {
        id: "malformed-choice",
        areaId: "area",
        title: "Choose a queue",
        pluginId: "recall.multiple-choice",
        pluginVersion: 1,
        revision: 1,
        objectiveIds: ["queue"],
        fallback: "Choose the queue.",
        payload: {
          prompt: "Which structure is FIFO?",
          options: [
            { id: "a", text: "Queue" },
            { id: "b", text: "Stack" },
          ],
          correctOptionIds: ["a"],
        },
      },
    ],
  };
  const result = await Effect.runPromise(Effect.either(inspectDeckQuality(deck)));
  assert.ok(Either.isRight(result));
  assert.equal(
    result.right.some((issue) => issue.code === "invalid-activity-payload"),
    true,
  );
  assert.equal(
    result.right.some((issue) => issue.severity === "blocking"),
    true,
  );
});

await test("bounded findings preserve a publishing blocker after many warnings", async () => {
  const cards: unknown[] = Array.from({ length: 60 }, (_, index) => ({
    kind: "basic",
    id: `card-${String(index)}`,
    front: "Repeated question",
    back: "Repeated answer",
    objectiveIds: ["queue"],
    tags: [],
    origin: "authored",
  }));
  cards.push({
    kind: "basic",
    id: "with-invalid-media",
    front: "Media question",
    back: "Media answer",
    objectiveIds: ["queue"],
    tags: [],
    origin: "authored",
    media: [{ id: "bad", mimeType: "image/png", byteLength: 10 }],
  });
  const result = await Effect.runPromise(Effect.either(inspectDeckQuality({ ...area, cards })));
  assert.ok(Either.isRight(result));
  assert.equal(result.right.length <= 50, true);
  assert.equal(
    result.right.some((issue) => issue.severity === "blocking"),
    true,
  );
});

await test("invalid deck input is a typed failure for publication gating", async () => {
  const result = await Effect.runPromise(
    Effect.either(inspectDeckQuality({ ...area, cards: "not-a-card-list" })),
  );
  assert.equal(Either.isLeft(result), true);
});
