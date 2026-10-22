import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { createPublicationFork, fromKnowledgeArea } from "@recall/application";
import {
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  type KnowledgeArea,
} from "@recall/domain";

const objectiveId = createObjectiveId("22222222-2222-4222-8222-222222222222");
const source: KnowledgeArea = {
  schemaVersion: "1.0.0",
  id: createAreaId("11111111-1111-4111-8111-111111111111"),
  title: "Shared notes",
  description: null,
  language: "en",
  objectives: [{ id: objectiveId, title: "Recall", description: null, prerequisiteIds: [] }],
  ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
  cards: [
    {
      kind: "basic",
      id: createAssessmentId("33333333-3333-4333-8333-333333333333"),
      front: "Question",
      back: "Answer",
      objectiveIds: [objectiveId],
      tags: [],
      origin: "authored",
      noteId: "note",
      templateId: "forward",
      presentation: { typedAnswer: { enabled: true, ignoreCase: true, ignoreAccents: false } },
    },
  ],
  noteLibrary: {
    types: [
      {
        id: "type",
        name: "Basic",
        fields: [{ name: "Front" }, { name: "Back" }],
        templates: [{ id: "forward", name: "Forward", front: "{{Front}}", back: "{{Back}}" }],
      },
    ],
    notes: [
      {
        id: "note",
        typeId: "type",
        fields: { Front: "Question", Back: "Answer" },
        tags: [],
        objectiveIds: [objectiveId],
      },
    ],
  },
  tags: [],
  licence: null,
};

void test("publication forks retain linked notes and remap their objectives through personal import", () => {
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
  const objective = fork.document.objectives.at(0);
  assert.ok(objective);
  assert.notEqual(objective.id, objectiveId);
  assert.deepEqual(fork.document.noteLibrary?.notes.at(0)?.objectiveIds, [objective.id]);
  assert.equal(fork.document.cards.at(0)?.noteId, "note");
  assert.deepEqual(fork.document.cards.at(0)?.presentation, source.cards.at(0)?.presentation);
  let sequence = 0;
  const imported = Effect.runSync(
    fromKnowledgeArea(
      fork.document,
      "#123456",
      false,
      () => `local-${String(++sequence)}`,
      new Date("2026-10-20T12:00:00Z"),
      true,
    ),
  );
  assert.notEqual(imported.objectives?.at(0)?.id, objective.id);
  assert.deepEqual(imported.noteLibrary?.notes.at(0)?.objectiveIds, [
    imported.objectives?.at(0)?.id,
  ]);
  assert.equal(imported.cards.at(0)?.noteId, "note");
});
