import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { createPublicationFork, diffKnowledgeAreas } from "@recall/application";
import {
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  type KnowledgeArea,
} from "@recall/domain";

const areaId = createAreaId("11111111-1111-4111-8111-111111111111");
const objectiveId = createObjectiveId("22222222-2222-4222-8222-222222222222");
const cardId = createAssessmentId("33333333-3333-4333-8333-333333333333");
const source: KnowledgeArea = {
  schemaVersion: "1.0.0",
  id: areaId,
  title: "Published area",
  description: null,
  language: "en",
  difficulty: "beginner",
  objectives: [{ id: objectiveId, title: "Recall", description: null, prerequisiteIds: [] }],
  ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
  cards: [
    {
      kind: "basic",
      id: cardId,
      front: "Question",
      back: "Answer",
      objectiveIds: [objectiveId],
      tags: [],
      origin: "authored",
    },
  ],
  tags: [],
  licence: null,
  activities: [
    {
      id: "activity:one",
      areaId,
      title: "Study the card",
      pluginId: "recall.basic",
      pluginVersion: 1,
      revision: 1,
      objectiveIds: [objectiveId],
      fallback: "Question",
      payload: { prompts: ["Question"], rubric: "Recall", reference: "Answer", cardId },
    },
  ],
};

void test("diff ignores fork-only identity changes in activity area, objectives, and built-in card refs", () => {
  const fork = Effect.runSync(
    createPublicationFork({
      ownerId: "44444444-4444-4444-8444-444444444444",
      operationId: "55555555-5555-4555-8555-555555555555",
      sourceVersionId: "66666666-6666-4666-8666-666666666666",
      source,
      attribution: null,
      license: null,
    }),
  );
  const result = Effect.runSync(diffKnowledgeAreas({ baseline: source, candidate: fork.document }));
  assert.deepEqual(result.activities, { added: [], changed: [], removed: [] });
  assert.deepEqual(
    result.metadata.filter((change) => change.field === "difficulty"),
    [],
  );
});

void test("author-declared difficulty survives publication forks and appears in metadata diffs", () => {
  const fork = Effect.runSync(
    createPublicationFork({
      ownerId: "44444444-4444-4444-8444-444444444444",
      operationId: "55555555-5555-4555-8555-555555555555",
      sourceVersionId: "66666666-6666-4666-8666-666666666666",
      source,
      attribution: null,
      license: null,
    }),
  );
  assert.equal(fork.document.difficulty, "beginner");
  const result = Effect.runSync(
    diffKnowledgeAreas({
      baseline: source,
      candidate: { ...source, difficulty: "advanced" },
    }),
  );
  assert.deepEqual(result.metadata, [
    { field: "difficulty", before: "beginner", after: "advanced" },
  ]);
});
