import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Schema } from "effect";
import { KnowledgeAreaSchema } from "@recall/domain";
import {
  applyDeckWorkspaceUpdate,
  fromKnowledgeArea,
  retainPublishedActivityDefinitions,
} from "@recall/application";

const areaId = "area:one";
const otherAreaId = "area:two";
const objectiveId = "objective:one";
const timestamp = "2026-10-15T10:00:00.000Z";
const activity = (id: string, title: string, revision: number, selectedAreaId = areaId) => ({
  id,
  sourceId: id,
  areaId: selectedAreaId,
  title,
  pluginId: "community.diagram",
  pluginVersion: 8,
  revision,
  objectiveIds: [objectiveId],
  fallback: title,
  payload: { nodes: ["A", true, null] },
});
const activityAttempt = (definition: ReturnType<typeof activity>) => ({
  id: "attempt:one",
  activity: definition,
  response: {
    answers: ["private response"],
    selectedOptionIds: [],
    selfScore: 0.5,
    assistance: "none",
  },
  result: {
    evidence: [
      {
        objectiveId,
        dimension: "recall",
        score: 0.5,
        confidence: 0.5,
        assistance: "none",
        assessment: "self",
        explanation: "Private evidence",
      },
    ],
    feedback: "Private feedback",
    evaluatorId: "self",
    evaluatorVersion: "1",
  },
  startedAt: timestamp,
  submittedAt: timestamp,
  acceptedAt: timestamp,
});
const document = (activities: readonly ReturnType<typeof activity>[]) => ({
  schemaVersion: "1.0.0",
  id: areaId,
  title: "Shared area",
  description: null,
  language: "en",
  objectives: [{ id: objectiveId, title: "Recall", description: null, prerequisiteIds: [] }],
  ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
  cards: [],
  tags: [],
  licence: null,
  activities,
});
const run = <A>(effect: Effect.Effect<A, unknown>): A => Effect.runSync(effect);

void test("fork receipt keeps local definition edits and never copies private attempts", () => {
  const local = activity("shared-activity", "Local edit", 2);
  const attempt = activityAttempt(local);
  const current = {
    schemaVersion: 1,
    areas: [],
    reviews: 0,
    activityLibrary: {
      version: 1,
      activities: [local, activity("other-area-activity", "Other area", 1, otherAreaId)],
      attempts: [attempt],
    },
  };
  const received = activity("shared-activity", "Published source", 1);
  const saved = run(retainPublishedActivityDefinitions(current, document([received])));
  assert.equal(
    saved.activityLibrary?.activities.find((item) => item.id === local.id)?.title,
    "Local edit",
  );
  assert.deepEqual(saved.activityLibrary.attempts, [attempt]);
  assert.ok(!JSON.stringify(document([received])).includes("private response"));
});

void test("fork merge rejects cross-area identity collisions and divergent equal revisions", async () => {
  const existing = activity("shared-id", "Current", 3, otherAreaId);
  const workspace = {
    schemaVersion: 1,
    areas: [],
    reviews: 0,
    activityLibrary: { version: 1, activities: [existing], attempts: [] },
  };
  const crossArea = await Effect.runPromise(
    Effect.either(
      retainPublishedActivityDefinitions(
        workspace,
        document([activity("shared-id", "Current", 3)]),
      ),
    ),
  );
  assert.ok("left" in crossArea);
  assert.equal(crossArea.left._tag, "ActivityFailure");
  assert.equal(crossArea.left.reason, "conflict");

  const sameArea = activity("shared-id", "Current", 3);
  const equalRevisionConflict = await Effect.runPromise(
    Effect.either(
      retainPublishedActivityDefinitions(
        { ...workspace, activityLibrary: { version: 1, activities: [sameArea], attempts: [] } },
        document([activity("shared-id", "Diverged", 3)]),
      ),
    ),
  );
  assert.ok("left" in equalRevisionConflict);
  assert.equal(equalRevisionConflict.left._tag, "ActivityFailure");
  assert.equal(equalRevisionConflict.left.reason, "conflict");
});

void test("selected update replaces one area's definitions and retires missing definitions", () => {
  const stale = activity("stale-activity", "Removed after update", 4);
  const retained = activity("kept-activity", "Before update", 2);
  const otherArea = activity("foreign-activity", "Unrelated", 1, otherAreaId);
  const attempt = activityAttempt(stale);
  const workspace = {
    schemaVersion: 1,
    areas: [],
    reviews: 0,
    activityLibrary: {
      version: 1,
      activities: [stale, retained, otherArea],
      attempts: [attempt],
    },
  };
  const updated = activity("kept-activity", "Selected upstream edit", 3);
  const saved = run(
    retainPublishedActivityDefinitions(workspace, document([updated]), { replaceArea: true }),
  );
  const definitions = saved.activityLibrary?.activities ?? [];
  assert.deepEqual(
    definitions.find((item) => item.id === stale.id),
    { ...stale, archived: true, revision: 5 },
  );
  assert.equal(
    definitions.find((item) => item.id === retained.id)?.title,
    "Selected upstream edit",
  );
  assert.equal(definitions.find((item) => item.id === otherArea.id)?.title, "Unrelated");
  assert.deepEqual(saved.activityLibrary?.attempts, [attempt]);
});

void test("workspace update persists selected activity definitions and archives omitted ones", async () => {
  const stale = activity("stale-activity", "Removed", 2);
  const selected = activity("kept-activity", "Before", 2);
  const attempt = activityAttempt(stale);
  const personalAreaId = "area:personal";
  const personalDefinitions = [
    { ...stale, areaId: personalAreaId },
    { ...selected, areaId: personalAreaId },
  ];
  const currentDocument = {
    ...document(personalDefinitions),
    id: personalAreaId,
    sourceId: areaId,
    forkedFromVersionId: "version:baseline",
  };
  const validatedCurrentDocument = Schema.decodeUnknownSync(KnowledgeAreaSchema)(currentDocument);
  const area = await Effect.runPromise(
    fromKnowledgeArea(
      validatedCurrentDocument,
      "#5965d8",
      true,
      () => "unused",
      new Date(timestamp),
      true,
    ),
  );
  const workspace = {
    schemaVersion: 1 as const,
    areas: [area],
    reviews: 0,
    activityLibrary: { version: 1 as const, activities: personalDefinitions, attempts: [attempt] },
  };
  const selectedDocument = {
    ...currentDocument,
    activities: [{ ...selected, areaId: personalAreaId, title: "Selected upstream" }],
  };
  const saved = await Effect.runPromise(
    applyDeckWorkspaceUpdate(
      {
        workspace,
        updatedArea: selectedDocument,
        newVersionId: "version:next",
        advanceBaseline: false,
      },
      new Date(timestamp),
      () => "unused",
    ),
  );
  assert.equal(
    saved.activityLibrary?.activities.find((item) => item.id === selected.id)?.title,
    "Selected upstream",
  );
  assert.equal(
    saved.activityLibrary.activities.find((item) => item.id === stale.id)?.archived,
    true,
  );
  assert.deepEqual(saved.activityLibrary.attempts, [attempt]);
});
