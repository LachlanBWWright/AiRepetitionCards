import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import { KnowledgeAreaSchema } from "@recall/domain";
import {
  applyDeckWorkspaceUpdate,
  applySelectedDeckUpdate,
  fromKnowledgeArea,
  toKnowledgeArea,
  publicationContentHash,
  retainPublishedActivityDefinitions,
} from "@recall/application";

const areaId = "11111111-1111-4111-8111-111111111111";
const objectiveId = "22222222-2222-4222-8222-222222222222";
const cardId = "33333333-3333-4333-8333-333333333333";
const localAreaId = "44444444-4444-4444-8444-444444444444";
const localObjectiveId = "55555555-5555-4555-8555-555555555555";
const localCardId = "66666666-6666-4666-8666-666666666666";
const document = (title: string, front: string, description = "") => ({
  schemaVersion: "1.0.0",
  id: areaId,
  title: "Local area title",
  description,
  language: "en",
  objectives: [
    { id: objectiveId, sourceId: "goal:one", title, description: null, prerequisiteIds: [] },
  ],
  ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
  cards: [
    {
      kind: "basic",
      id: cardId,
      sourceId: "card:one",
      front,
      back: "Answer",
      objectiveIds: [objectiveId],
      tags: [],
      origin: "imported",
    },
  ],
  tags: [],
  licence: null,
});

await test("selected update keeps personal identities and local metadata, and reports replaced local edits", async () => {
  const base = document("Goal", "Old question");
  const fork = document("Goal", "Locally edited question", "personal description");
  const current = {
    ...fork,
    id: localAreaId,
    sourceId: areaId,
    forkedFromVersionId: "77777777-7777-4777-8777-777777777777",
    objectives: fork.objectives.map((item) => ({
      ...item,
      id: localObjectiveId,
      sourceId: "goal:one",
    })),
    cards: fork.cards.map((item) => ({
      ...item,
      id: localCardId,
      sourceId: "card:one",
      objectiveIds: [localObjectiveId],
    })),
  };
  const upstream = document("Renamed goal", "New question", "upstream description");
  const denied = await Effect.runPromise(
    Effect.either(
      applySelectedDeckUpdate({
        baseline: base,
        current,
        upstream,
        selectedSourceIds: ["goal:one", "card:one"],
      }),
    ),
  );
  assert.ok("left" in denied);
  assert.deepEqual(denied.left, {
    _tag: "DeckUpdateFailure",
    reason: "local-conflict",
    sourceIds: ["card:one"],
  });
  const result = await Effect.runPromise(
    applySelectedDeckUpdate({
      baseline: base,
      current,
      upstream,
      selectedSourceIds: ["goal:one", "card:one"],
      confirmedConflictSourceIds: ["card:one"],
    }),
  );
  assert.equal(result.area.title, "Local area title");
  assert.equal(result.area.description, "personal description");
  const updatedCard = result.area.cards[0];
  assert.ok(updatedCard);
  assert.equal(updatedCard.id, localCardId);
  assert.ok(updatedCard.kind === "basic");
  assert.equal(updatedCard.front, "New question");
  const updatedObjective = result.area.objectives[0];
  assert.ok(updatedObjective);
  assert.equal(updatedObjective.id, localObjectiveId);
  assert.equal(updatedObjective.title, "Renamed goal");
  assert.deepEqual(result.locallyModifiedSourceIds, ["card:one"]);
  assert.equal("reviewEvents" in result.area, false);
});

await test("unselected imported content remains unchanged", async () => {
  const base = document("Goal", "Old question");
  const current = {
    ...base,
    id: localAreaId,
    sourceId: areaId,
    forkedFromVersionId: "77777777-7777-4777-8777-777777777777",
    objectives: base.objectives.map((item) => ({
      ...item,
      id: localObjectiveId,
      sourceId: "goal:one",
    })),
    cards: base.cards.map((item) => ({
      ...item,
      id: localCardId,
      sourceId: "card:one",
      objectiveIds: [localObjectiveId],
    })),
  };
  const result = await Effect.runPromise(
    applySelectedDeckUpdate({
      baseline: base,
      current,
      upstream: document("New goal", "New question"),
      selectedSourceIds: [],
    }),
  );
  assert.equal(
    result.area.cards[0]?.kind === "basic" ? result.area.cards[0].front : null,
    "Old question",
  );
  assert.equal(result.area.objectives[0]?.title, "Goal");
  assert.deepEqual(result.locallyModifiedSourceIds, []);
});

await test("selected activity definitions update while keeping local definition and objective IDs", async () => {
  const activity = (
    title: string,
    id: string,
    area: string,
    objective: string,
    cardReference = cardId,
  ) => ({
    id,
    sourceId: "activity:one",
    areaId: area,
    title,
    pluginId: "recall.basic",
    pluginVersion: 1,
    revision: title === "Old" ? 10 : title === "Updated" ? 2 : 1,
    objectiveIds: [objective],
    fallback: "Draw the concept",
    payload: {
      cardId: cardReference,
      prompts: ["Question"],
      rubric: "Recall",
      reference: "Answer",
    },
  });
  const baseline = {
    ...document("Goal", "Question"),
    activities: [activity("Old", "source-activity", areaId, objectiveId)],
  };
  const current = {
    ...baseline,
    id: localAreaId,
    sourceId: areaId,
    forkedFromVersionId: "77777777-7777-4777-8777-777777777777",
    objectives: baseline.objectives.map((item) => ({ ...item, id: localObjectiveId })),
    cards: baseline.cards.map((item) => ({
      ...item,
      id: localCardId,
      objectiveIds: [localObjectiveId],
    })),
    activities: [activity("Old", "local-activity", localAreaId, localObjectiveId, localCardId)],
  };
  const upstream = {
    ...baseline,
    activities: [activity("Updated", "source-activity", areaId, objectiveId)],
  };
  const result = await Effect.runPromise(
    applySelectedDeckUpdate({
      baseline,
      current,
      upstream,
      selectedSourceIds: ["activity:one"],
      confirmedConflictSourceIds: ["activity:one"],
    }),
  );
  const updatedActivity = result.area.activities?.[0];
  assert.ok(updatedActivity);
  assert.equal(updatedActivity.id, "local-activity");
  assert.equal(updatedActivity.areaId, localAreaId);
  assert.equal(updatedActivity.title, "Updated");
  assert.deepEqual(updatedActivity.objectiveIds, [localObjectiveId]);
  assert.equal(updatedActivity.payload.cardId, localCardId);
  assert.equal(updatedActivity.revision, 11);
  const saved = await Effect.runPromise(
    retainPublishedActivityDefinitions(
      {
        schemaVersion: 1,
        areas: [],
        reviews: 0,
        activityLibrary: { version: 1, activities: [current.activities[0]], attempts: [] },
      },
      result.area,
      { replaceArea: true },
    ),
  );
  assert.equal(
    saved.activityLibrary?.activities.find((entry) => entry.id === "local-activity")?.revision,
    11,
  );
});

await test("workspace apply keeps schedules and reviews, archives replaced content, and advances baseline only on full updates", async () => {
  const now = new Date("2026-10-15T10:00:00.000Z");
  const source = {
    ...document("Goal", "Old question"),
    id: localAreaId,
    sourceId: areaId,
    forkedFromVersionId: "77777777-7777-4777-8777-777777777777",
    objectives: [
      {
        id: localObjectiveId,
        sourceId: "goal:one",
        title: "Goal",
        description: null,
        prerequisiteIds: [],
      },
    ],
    cards: [
      {
        kind: "basic" as const,
        id: localCardId,
        sourceId: "card:one",
        front: "Old question",
        back: "Answer",
        objectiveIds: [localObjectiveId],
        tags: [],
        origin: "imported" as const,
      },
    ],
  };
  const sourceDocument = await Effect.runPromise(Schema.decodeUnknown(KnowledgeAreaSchema)(source));
  const area = await Effect.runPromise(
    fromKnowledgeArea(sourceDocument, "#336699", true, () => "unused", now, true),
  );
  const reviewedArea = {
    ...area,
    cards: area.cards.map((card) => ({ ...card, schedule: { ...card.schedule, reps: 3 } })),
  };
  const reviewEvents = [
    {
      id: "review-one",
      areaId: localAreaId,
      cardId: localCardId,
      ratedAt: now.toISOString(),
      rating: "good" as const,
      schedulerFamily: "fsrs" as const,
      schedulerVersion: "1",
    },
  ];
  const workspace = { schemaVersion: 1 as const, areas: [reviewedArea], reviews: 1, reviewEvents };
  const baseline = await Effect.runPromise(toKnowledgeArea(reviewedArea, true, true));
  const fingerprint = publicationContentHash(baseline);
  const upstream = {
    ...sourceDocument,
    cards: sourceDocument.cards.map((card) => ({ ...card, front: "Updated question" })),
  };
  const partial = await Effect.runPromise(
    applyDeckWorkspaceUpdate(
      {
        workspace,
        updatedArea: upstream,
        newVersionId: "88888888-8888-4888-8888-888888888888",
        advanceBaseline: false,
        expectedCurrentAreaContentFingerprint: fingerprint,
      },
      now,
      () => "unused",
    ),
  );
  const updatedArea = partial.areas[0];
  assert.ok(updatedArea);
  const updatedCard = updatedArea.cards[0];
  assert.ok(updatedCard);
  assert.equal(updatedCard.schedule.reps, 3);
  assert.equal(updatedCard.front, "Updated question");
  assert.equal(updatedArea.forkedFromVersionId, "77777777-7777-4777-8777-777777777777");
  assert.deepEqual(partial.reviewEvents, reviewEvents);
  const cardVersions = partial.cardVersions;
  assert.ok(cardVersions);
  assert.equal(cardVersions.length, 1);
  const archived = cardVersions[0];
  assert.ok(archived);
  assert.equal(archived.card.front, "Old question");
  const full = await Effect.runPromise(
    applyDeckWorkspaceUpdate(
      {
        workspace,
        updatedArea: upstream,
        newVersionId: "88888888-8888-4888-8888-888888888888",
        advanceBaseline: true,
      },
      now,
      () => "unused",
    ),
  );
  const fullyUpdatedArea = full.areas[0];
  assert.ok(fullyUpdatedArea);
  assert.equal(fullyUpdatedArea.forkedFromVersionId, "88888888-8888-4888-8888-888888888888");
});
