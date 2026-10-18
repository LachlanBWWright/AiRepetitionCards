import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import {
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  type KnowledgeArea,
} from "@recall/domain";
import {
  exportPortableDeckPackage,
  importPortableDeckPackage,
  checkPortableDeckPrivateRestore,
  acceptPortableDeckImport,
} from "../../../application/src/interchange/portable/portable-deck-package";

const areaId = createAreaId("00000000-0000-4000-8000-000000000101");
const cardId = createAssessmentId("00000000-0000-4000-8000-000000000102");
const objectiveId = createObjectiveId("00000000-0000-4000-8000-000000000103");
const area: KnowledgeArea = {
  schemaVersion: "1.0.0",
  id: areaId,
  title: "Deck",
  description: null,
  language: "en",
  objectives: [{ id: objectiveId, title: "Concept", description: null, prerequisiteIds: [] }],
  ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
  cards: [
    {
      kind: "basic",
      id: cardId,
      front: "Q",
      back: "A",
      objectiveIds: [objectiveId],
      tags: [],
      origin: "authored",
    },
  ],
  tags: [],
  licence: null,
};
const mediaStore = {
  get: () => Effect.succeed(null),
  put: () => Effect.void,
  delete: () => Effect.void,
  list: Effect.succeed([]),
};
function success<A, E>(effect: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(effect));
  assert.ok(Either.isRight(result));
  return result.right;
}

void test("private restore requires an explicit collision-free single-deck copy", () => {
  const currentArea = {
    id: areaId,
    title: "Deck",
    color: "#123456",
    cards: [
      {
        id: cardId,
        front: "Q",
        back: "A",
        objective: "Concept",
        objectiveIds: [objectiveId],
        tags: [],
        origin: "authored" as const,
        schedule: {
          due: "2026-10-15T00:00:00.000Z",
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          learning_steps: 0,
          reps: 0,
          lapses: 0,
          state: 0 as const,
        },
      },
    ],
    objectives: [{ id: objectiveId, title: "Concept", description: null, prerequisiteIds: [] }],
  };
  const archive = success(
    exportPortableDeckPackage(area, mediaStore, {
      currentArea,
      reviewEvents: [],
      cardVersions: [],
      activityLibrary: { version: 1, activities: [], attempts: [] },
    }),
  );
  const imported = success(importPortableDeckPackage(archive));
  const clean = { schemaVersion: 1 as const, areas: [], reviews: 0 };
  assert.deepEqual(checkPortableDeckPrivateRestore(imported, clean), { accepted: true });
  const privateRestore = success(
    acceptPortableDeckImport({
      imported,
      workspace: clean,
      color: "#123456",
      createId: () => "unused",
      now: new Date("2026-10-15T00:00:00.000Z"),
      restorePrivateHistory: true,
    }),
  );
  assert.equal(privateRestore.area.id, areaId);
  assert.deepEqual(privateRestore.area.cards[0]?.schedule, currentArea.cards[0]?.schedule);
  assert.deepEqual(
    checkPortableDeckPrivateRestore(imported, {
      ...clean,
      areas: [
        {
          id: areaId,
          title: "Existing",
          color: "#000000",
          cards: [],
        },
      ],
    }),
    { accepted: false, reason: "identity-collision" },
  );
  assert.deepEqual(
    checkPortableDeckPrivateRestore(
      success(importPortableDeckPackage(success(exportPortableDeckPackage(area, mediaStore)))),
      clean,
    ),
    {
      accepted: false,
      reason: "public-package",
    },
  );
});

void test("public acceptance remaps IDs and trusted built-in card references without changing existing schedules", () => {
  const source = {
    ...area,
    activities: [
      {
        id: "activity-1",
        areaId,
        title: "Practice",
        pluginId: "recall.quiz",
        pluginVersion: 1,
        revision: 1,
        objectiveIds: [objectiveId],
        fallback: "Question",
        payload: { cardId },
      },
      {
        id: "activity-opaque",
        areaId,
        title: "Opaque",
        pluginId: "third-party.plugin",
        pluginVersion: 1,
        revision: 1,
        objectiveIds: [objectiveId],
        fallback: "Question",
        payload: { cardId, privatePluginField: { untouched: true } },
      },
    ],
  } satisfies KnowledgeArea;
  const imported = success(
    importPortableDeckPackage(success(exportPortableDeckPackage(source, mediaStore))),
  );
  const schedule = {
    due: "2026-10-16T00:00:00.000Z",
    stability: 4,
    difficulty: 5,
    elapsed_days: 1,
    scheduled_days: 2,
    learning_steps: 0,
    reps: 3,
    lapses: 1,
    state: 2 as const,
    last_review: null,
  };
  const existing = {
    id: createAreaId("existing-area"),
    title: "Existing",
    color: "#000000",
    cards: [
      {
        id: createAssessmentId("existing-card"),
        front: "Old",
        back: "answer",
        objective: "Old",
        schedule,
      },
    ],
  };
  const workspace = { schemaVersion: 1 as const, areas: [existing], reviews: 0 };
  let nextId = 0;
  const accepted = success(
    acceptPortableDeckImport({
      imported,
      workspace,
      color: "#123456",
      createId: () => `fresh-${String(++nextId)}`,
      now: new Date("2026-10-15T00:00:00.000Z"),
      restorePrivateHistory: false,
    }),
  );
  assert.deepEqual(accepted.workspace.areas[0]?.cards[0]?.schedule, schedule);
  const copied = accepted.workspace.areas[1];
  assert.ok(copied);
  assert.notEqual(copied.id, areaId);
  assert.notEqual(copied.cards[0]?.id, cardId);
  const library = accepted.workspace.activityLibrary;
  assert.ok(library);
  const activity = library.activities[0];
  assert.ok(activity);
  assert.notEqual(activity.id, "activity-1");
  assert.equal(activity.payload.cardId, copied.cards[0]?.id);
  const opaqueActivity = library.activities[1];
  assert.ok(opaqueActivity);
  assert.equal(opaqueActivity.payload.cardId, cardId);
  assert.deepEqual(opaqueActivity.payload.privatePluginField, { untouched: true });
});
