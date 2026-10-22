import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { createAreaId, type NoteType, type StudyNote, type Workspace } from "@recall/domain";
import {
  BASIC_NOTE_TYPE,
  collectNoteArea,
  deleteLearningArea,
  fromKnowledgeArea,
  noteOwnershipConflicts,
  prepareNoteSave,
  recordReview,
  resolveNoteSource,
  saveStudyNote,
  toKnowledgeArea,
  workspaceAuthoringBaseline,
  rebuildWorkspaceSchedules,
  undoReview,
  administerCards,
  searchStudyCards,
  studyCalendar,
  studyStatistics,
} from "@recall/application";
const now = new Date("2026-10-22T00:00:00Z");
const ownerId = createAreaId("owner");
const destinationId = createAreaId("destination");
const note: StudyNote = {
  id: "source-note",
  typeId: "basic",
  fields: { Front: "Question", Back: "Answer" },
  tags: [],
  objectiveIds: [],
};
const template = BASIC_NOTE_TYPE.templates[0];
assert.ok(template);
const type: NoteType = {
  ...BASIC_NOTE_TYPE,
  templates: [{ ...template, deckAreaId: destinationId }],
};
const initial: Workspace = {
  schemaVersion: 1,
  reviews: 0,
  areas: [
    { id: ownerId, title: "Source", color: "#123456", cards: [] },
    { id: destinationId, title: "Destination", color: "#123456", cards: [] },
  ],
};
function success<A, E>(operation: Effect.Effect<A, E>) {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}
function routed() {
  return success(
    saveStudyNote(
      initial,
      { areaId: ownerId, type, note, cardIds: [{ templateId: "forward", cardId: "card" }] },
      now,
    ),
  );
}
void test("template placement creates a self-contained destination and resolves editing to its canonical source", () => {
  const workspace = routed();
  const owner = workspace.areas[0];
  const destination = workspace.areas[1];
  assert.ok(owner);
  assert.ok(destination);
  assert.equal(owner.cards.length, 0);
  assert.equal(destination.cards[0]?.front, "Question");
  const snapshot = destination.noteLibrary?.notes[0];
  assert.ok(snapshot);
  assert.deepEqual(resolveNoteSource(workspace, destination, snapshot.id), {
    area: owner,
    noteId: note.id,
  });
  assert.equal(noteOwnershipConflicts(workspace, owner).length, 0);
  const command = success(
    prepareNoteSave(
      collectNoteArea(workspace, owner),
      type,
      { ...note, fields: { Front: "Changed", Back: "Answer" } },
      () => "unused",
    ),
  );
  assert.ok(command.kind === "save-note");
  assert.equal(command.cardIds.length, 0);
  const updated = success(saveStudyNote(workspace, command, now));
  assert.equal(updated.areas[1]?.cards[0]?.id, "card");
  const updatedDestination = updated.areas[1];
  assert.ok(updatedDestination);
  const updatedCard = updatedDestination.cards[0];
  assert.ok(updatedCard);
  assert.equal(updatedCard.front, "Changed");
  assert.ok(updatedDestination.noteLibrary);
  assert.equal(updatedDestination.noteLibrary.notes[0]?.fields.Front, "Changed");
});
void test("routed reviewed cards preserve scheduling and immutable history across repeated deck moves", () => {
  const workspace = success(
    recordReview({
      workspace: routed(),
      areaId: destinationId,
      cardId: "card",
      eventId: "review",
      rating: "good",
      ratedAt: now.toISOString(),
    }),
  ).workspace;
  const command = {
    areaId: ownerId,
    type,
    note: { ...note, fields: { Front: "Edited", Back: "Answer" } },
    cardIds: [],
  };
  const updated = success(saveStudyNote(workspace, command, now));
  assert.deepEqual(updated.reviewEvents, workspace.reviewEvents);
  assert.deepEqual(updated.areas[1]?.cards[0]?.schedule, workspace.areas[1]?.cards[0]?.schedule);
  const moved = success(saveStudyNote(updated, { ...command, type: BASIC_NOTE_TYPE }, now));
  assert.equal(moved.areas[1]?.cards.length, 0);
  assert.equal(moved.areas[0]?.cards[0]?.id, "card");
  assert.deepEqual(moved.reviewEvents, workspace.reviewEvents);
  const replayed = success(rebuildWorkspaceSchedules(moved));
  assert.deepEqual(replayed.areas[0]?.cards[0]?.schedule, workspace.areas[1]?.cards[0]?.schedule);
  const second = success(
    recordReview({
      workspace: replayed,
      areaId: ownerId,
      cardId: "card",
      eventId: "second-review",
      rating: "easy",
      ratedAt: new Date(now.getTime() + 86_400_000).toISOString(),
    }),
  ).workspace;
  assert.equal(second.reviewEvents?.[1]?.baseReviewEventId, "review");
  const returned = success(saveStudyNote(second, command, now));
  assert.equal(returned.areas[1]?.cards[0]?.id, "card");
  assert.deepEqual(returned.reviewEvents, second.reviewEvents);
  assert.deepEqual(
    success(rebuildWorkspaceSchedules(returned)).areas[1]?.cards[0]?.schedule,
    second.areas[0]?.cards[0]?.schedule,
  );
  const undone = success(
    undoReview(
      returned,
      {
        kind: "undo-review",
        eventId: "second-review",
        operationId: "undo-second",
      },
      now,
    ),
  );
  assert.deepEqual(undone.areas[1]?.cards[0]?.schedule, workspace.areas[1]?.cards[0]?.schedule);
  assert.equal(
    success(searchStudyCards(returned, "rated:7:good", now.getTime() + 86_400_000)).length,
    1,
  );
  const stats = studyStatistics(
    returned,
    now.getTime() + 86_400_000,
    studyCalendar(now.getTime() + 86_400_000),
    destinationId,
  );
  assert.equal(
    stats.calendar.reduce((sum, day) => sum + day.reviews, 0),
    2,
  );
  const adjusted = success(
    administerCards(
      returned,
      {
        kind: "administer-cards",
        areaId: destinationId,
        cardIds: ["card"],
        operationId: "due-before-move",
        action: "due",
        due: "2027-01-01T00:00:00Z",
      },
      now,
    ),
  );
  const adjustedMove = success(saveStudyNote(adjusted, { ...command, type: BASIC_NOTE_TYPE }, now));
  assert.equal(
    success(rebuildWorkspaceSchedules(adjustedMove)).areas[0]?.cards[0]?.schedule.due,
    "2027-01-01T00:00:00.000Z",
  );
});
void test("destination snapshots publish independently without private ownership/deck pointers", () => {
  const workspace = routed();
  const destination = workspace.areas[1];
  assert.ok(destination);
  const published = success(toKnowledgeArea(destination, false, true));
  assert.equal(published.noteLibrary?.notes[0]?.source, undefined);
  assert.equal(published.noteLibrary?.types[0]?.templates[0]?.deckAreaId, undefined);
  const imported = success(
    fromKnowledgeArea(published, "#123456", false, () => "fresh", now, true),
  );
  assert.equal(imported.cards[0]?.front, "Question");
  assert.equal(imported.noteLibrary?.notes[0]?.source, undefined);
  const privateDocument = success(toKnowledgeArea(destination, true, true));
  const restored = success(
    fromKnowledgeArea(privateDocument, "#123456", true, () => "fresh", now, true),
  );
  assert.deepEqual(
    restored.noteLibrary?.notes[0]?.source,
    destination.noteLibrary?.notes[0]?.source,
  );
});
void test("partial sync or independent destination field edits require an explicit conflict decision", () => {
  const workspace = routed();
  const changed: Workspace = {
    ...workspace,
    areas: workspace.areas.map((area) =>
      area.id === destinationId && area.noteLibrary
        ? {
            ...area,
            noteLibrary: {
              ...area.noteLibrary,
              notes: area.noteLibrary.notes.map((item) => ({
                ...item,
                fields: { ...item.fields, Front: "Independent edit" },
              })),
            },
          }
        : area,
    ),
  };
  const owner = changed.areas[0];
  assert.ok(owner);
  assert.equal(noteOwnershipConflicts(changed, owner)[0]?.fields.Front, "Independent edit");
  const rejected = Effect.runSync(
    Effect.either(saveStudyNote(changed, { areaId: ownerId, type, note, cardIds: [] }, now)),
  );
  assert.ok(Either.isLeft(rejected));
  const approved = success(
    saveStudyNote(
      changed,
      {
        areaId: ownerId,
        type,
        note,
        cardIds: [],
        migration: {
          fields: {},
          templates: {},
          confirmRemoval: false,
          confirmLinkedSnapshots: true,
        },
      },
      now,
    ),
  );
  assert.equal(noteOwnershipConflicts(approved, approved.areas[0] ?? owner).length, 0);
  const command = { kind: "save-note" as const, areaId: ownerId, type, note, cardIds: [] };
  assert.notEqual(
    workspaceAuthoringBaseline(workspace, command),
    workspaceAuthoringBaseline(changed, command),
  );
});
void test("deleting a canonical owner leaves destination content independently editable", () => {
  const workspace = routed();
  const deleted = success(deleteLearningArea(workspace, ownerId, now)).workspace;
  const destination = deleted.areas[0];
  assert.ok(destination);
  assert.equal(destination.noteLibrary?.notes[0]?.source, undefined);
  assert.equal(destination.noteLibrary?.types[0]?.templates[0]?.deckAreaId, undefined);
  assert.equal(destination.cards[0]?.id, "card");
});
