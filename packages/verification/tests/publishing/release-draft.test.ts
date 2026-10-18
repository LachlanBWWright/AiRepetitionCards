import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import {
  previewRelease,
  readReleaseDraft,
  releaseDraftForArea,
  writeReleaseDraft,
  type ReleaseDraftStore,
} from "@recall/application";
import {
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  type KnowledgeArea,
} from "@recall/domain";
const objectiveId = createObjectiveId("33333333-3333-4333-8333-333333333333");

const area: KnowledgeArea = {
  schemaVersion: "1.0.0",
  id: createAreaId("11111111-1111-4111-8111-111111111111"),
  title: "Deck",
  description: null,
  language: "en",
  objectives: [{ id: objectiveId, title: "Remember", description: null, prerequisiteIds: [] }],
  ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
  cards: [
    {
      kind: "basic",
      id: createAssessmentId("22222222-2222-4222-8222-222222222222"),
      front: "Q",
      back: "A",
      objectiveIds: [objectiveId],
      tags: [],
      origin: "authored",
    },
  ],
  activities: [],
  tags: [],
  licence: null,
  attribution: null,
};

void test("release drafts are area scoped and store publishing fields only", async () => {
  const saved = { current: null as string | null };
  const store: ReleaseDraftStore = {
    read: () => Effect.succeed(saved.current),
    write: (_id, value) =>
      Effect.sync(() => {
        saved.current = value;
      }),
    clear: () =>
      Effect.sync(() => {
        saved.current = null;
      }),
  };
  const draft = releaseDraftForArea(
    area,
    {
      visibility: "public",
      releaseNotes: "Updated card",
      attribution: "",
      license: "CC BY 4.0",
      reuseConfirmed: true,
    },
    10_000,
  );
  await Effect.runPromise(writeReleaseDraft(store, draft));
  assert.equal(
    (await Effect.runPromise(readReleaseDraft(store, area.id, 11_000)))?.releaseNotes,
    "Updated card",
  );
  assert.equal(await Effect.runPromise(readReleaseDraft(store, "another-area", 11_000)), null);
  assert.ok(saved.current);
  assert.equal(saved.current.includes("attempt"), false);
  assert.equal(saved.current.includes("back"), false);
});

void test("release preview includes card and activity changes with reference warnings", async () => {
  const candidate = {
    ...area,
    cards: area.cards.slice(1),
    activities: [
      {
        id: "activity:1",
        areaId: area.id,
        title: "Practice",
        pluginId: "recall.basic",
        pluginVersion: 1,
        revision: 1,
        objectiveIds: [objectiveId],
        fallback: "Q",
        payload: {},
      },
    ],
  };
  const preview = await Effect.runPromise(previewRelease(area, candidate));
  assert.equal(preview.diff.cards.removed.length, 1);
  assert.equal(preview.diff.activities.added.length, 1);
  assert.equal(preview.warnings.length, 1);
  assert.match(preview.warnings[0] ?? "", /card change/);
});
