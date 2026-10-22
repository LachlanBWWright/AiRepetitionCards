import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { createAreaId, type Workspace } from "@recall/domain";
import {
  CLOZE_NOTE_TYPE,
  REVERSED_NOTE_TYPE,
  applyWorkspaceAuthoringCommand,
  collectNoteArea,
  prepareNoteSave,
  recordReview,
  saveStudyNote,
  studyQueue,
} from "@recall/application";

const now = new Date("2026-10-22T12:00:00Z");
const ownerId = createAreaId("canonical-owner");
const destinationId = createAreaId("derived-destination");
const initial: Workspace = {
  schemaVersion: 1,
  reviews: 0,
  areas: [
    { id: ownerId, title: "Owner", color: "#123456", cards: [] },
    { id: destinationId, title: "Destination", color: "#123456", cards: [] },
  ],
};
function success<A, E>(effect: Effect.Effect<A, E>) {
  const result = Effect.runSync(Effect.either(effect));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}
await test("ordinary edits and cloze batch replacement cannot silently detach a routed note snapshot", () => {
  const template = CLOZE_NOTE_TYPE.templates[0];
  assert.ok(template);
  const type = { ...CLOZE_NOTE_TYPE, templates: [{ ...template, deckAreaId: destinationId }] };
  const note = {
    id: "cloze-source",
    typeId: type.id,
    fields: { Text: "{{c1::original}}" },
    tags: [],
    objectiveIds: [],
  };
  const workspace = success(
    saveStudyNote(
      initial,
      {
        areaId: ownerId,
        type,
        note,
        cardIds: [{ templateId: template.id, deletionIndex: 1, cardId: "routed-cloze" }],
      },
      now,
    ),
  );
  const before = structuredClone(workspace);
  const commands = [
    {
      kind: "replace-card-fields",
      areaId: destinationId,
      cardIds: ["routed-cloze"],
      field: "cloze",
      find: "original",
      replacement: "edited",
    },
    {
      kind: "update-card",
      areaId: destinationId,
      cardId: "routed-cloze",
      content: {
        kind: "cloze",
        front: "ignored",
        back: "ignored",
        cloze: { text: "{{c1::edited}}", deletionIndex: 1 },
        tags: [],
        objectiveIds: [],
        media: [],
      },
    },
  ];
  for (const command of commands) {
    const result = Effect.runSync(
      Effect.either(applyWorkspaceAuthoringCommand(workspace, command, now)),
    );
    assert.ok(
      Either.isLeft(result),
      "Derived snapshots must be edited through their canonical source.",
    );
    assert.match(result.left.message, /source|shared note|original/i);
    assert.deepEqual(workspace, before);
  }
});

await test("cross-area siblings bury by canonical note source with day boundaries and retry exemptions", () => {
  const type = {
    ...REVERSED_NOTE_TYPE,
    templates: REVERSED_NOTE_TYPE.templates.map((template, index) => ({
      ...template,
      ...(index ? { deckAreaId: destinationId } : {}),
    })),
  };
  const note = {
    id: "shared",
    typeId: type.id,
    fields: { Front: "Question", Back: "Answer" },
    tags: [],
    objectiveIds: [],
  };
  let nextId = 0;
  const initialOwner = initial.areas[0];
  assert.ok(initialOwner);
  const command = success(
    prepareNoteSave(initialOwner, type, note, () => `sibling-${String(nextId++)}`),
  );
  const generated = success(saveStudyNote(initial, command, now));
  const owner = generated.areas[0];
  const card = owner?.cards[0];
  assert.ok(owner && card);
  const reviewed = success(
    recordReview({
      workspace: generated,
      areaId: ownerId,
      cardId: card.id,
      eventId: "seen-owner",
      rating: "again",
      ratedAt: now.toISOString(),
    }),
  ).workspace;
  const destination = reviewed.areas[1];
  assert.ok(destination);
  const day = { startsAt: now.getTime() - 1000, endsAt: now.getTime() + 86_400_000 };
  assert.equal(studyQueue(reviewed, destination, now.getTime(), day).buriedCount, 1);
  const independent = {
    ...destination,
    noteLibrary: destination.noteLibrary
      ? {
          ...destination.noteLibrary,
          notes: destination.noteLibrary.notes.map((item) => ({ ...item, source: undefined })),
        }
      : undefined,
  };
  const detached = {
    ...reviewed,
    areas: reviewed.areas.map((area) => (area.id === destination.id ? independent : area)),
  };
  assert.equal(
    studyQueue(detached, independent, now.getTime(), day).buriedCount,
    0,
    "Independent copies must not inherit cross-deck burying through a stale siblingId.",
  );
  assert.equal(
    studyQueue(reviewed, destination, now.getTime(), {
      startsAt: now.getTime() + 86_400_000,
      endsAt: now.getTime() + 2 * 86_400_000,
    }).buriedCount,
    0,
  );
  const reviewedOwner = reviewed.areas[0];
  assert.ok(reviewedOwner);
  const dueOwner = {
    ...reviewedOwner,
    cards: reviewedOwner.cards.map((item) => ({
      ...item,
      schedule: { ...item.schedule, due: now.toISOString() },
    })),
  };
  assert.equal(
    studyQueue(reviewed, dueOwner, now.getTime(), day).cards.some((item) => item.id === card.id),
    true,
  );
  const collected = collectNoteArea(reviewed, owner);
  assert.equal(collected.cards.length, 2);
});
