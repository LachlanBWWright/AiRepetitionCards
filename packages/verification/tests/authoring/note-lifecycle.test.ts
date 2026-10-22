import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { createAreaId, type NoteType, type StudyNote, type Workspace } from "@recall/domain";
import {
  BASIC_NOTE_TYPE,
  REVERSED_NOTE_TYPE,
  prepareNoteSave,
  saveStudyNote,
  previewNoteMigration,
} from "@recall/application";
const now = new Date("2026-10-22T00:00:00Z");
const areaId = createAreaId("notes");
const note = {
  id: "note",
  typeId: "basic",
  fields: { Front: "Question", Back: "Answer" },
  tags: [],
  objectiveIds: [],
};
function initial(): Workspace {
  return Effect.runSync(
    saveStudyNote(
      {
        schemaVersion: 1,
        reviews: 0,
        areas: [{ id: areaId, title: "Notes", color: "#123456", cards: [] }],
      },
      { areaId, type: BASIC_NOTE_TYPE, note, cardIds: [{ templateId: "forward", cardId: "card" }] },
      now,
    ),
  );
}
function save(
  workspace: Workspace,
  type: NoteType,
  nextNote: StudyNote,
  migration: {
    readonly fields: Readonly<Record<string, string>>;
    readonly templates: Readonly<Record<string, string>>;
    readonly confirmRemoval: boolean;
  },
) {
  const area = workspace.areas[0];
  assert.ok(area);
  const command = Effect.runSync(
    prepareNoteSave(area, type, nextNote, () => "new-card", migration),
  );
  return Effect.runSync(saveStudyNote(workspace, command, now));
}
void test("renaming a field migrates every source note and retains review identities", () => {
  let workspace = initial();
  workspace = Effect.runSync(
    saveStudyNote(
      workspace,
      {
        areaId,
        note: { ...note, id: "second" },
        cardIds: [{ templateId: "forward", cardId: "second-card" }],
      },
      now,
    ),
  );
  const type = {
    ...BASIC_NOTE_TYPE,
    fields: [{ name: "Question" }, { name: "Back" }],
    templates: [{ id: "forward", name: "Forward", front: "{{Question}}", back: "{{Back}}" }],
  };
  const result = save(
    workspace,
    type,
    { ...note, fields: { Question: "Question", Back: "Answer" } },
    { fields: { Question: "Front" }, templates: {}, confirmRemoval: false },
  );
  assert.deepEqual(result.areas[0]?.cards.map((card) => card.id).sort(), ["card", "second-card"]);
  const resultArea = result.areas[0];
  assert.ok(resultArea);
  assert.ok(resultArea.noteLibrary);
  assert.deepEqual(
    resultArea.noteLibrary.notes.map((item) => item.fields),
    [
      { Question: "Question", Back: "Answer" },
      { Question: "Question", Back: "Answer" },
    ],
  );
  assert.deepEqual(resultArea.cards[0]?.schedule, workspace.areas[0]?.cards[0]?.schedule);
});
void test("changing a note type maps a card identity without changing its history", () => {
  const workspace = initial();
  const type = {
    ...REVERSED_NOTE_TYPE,
    templates: [{ id: "different-forward", name: "Forward", front: "{{Front}}", back: "{{Back}}" }],
  };
  const result = save(
    workspace,
    type,
    { ...note, typeId: type.id },
    {
      fields: { Front: "Front", Back: "Back" },
      templates: { "different-forward": "forward" },
      confirmRemoval: false,
    },
  );
  const resultArea = result.areas[0];
  assert.ok(resultArea);
  const resultCard = resultArea.cards[0];
  assert.ok(resultCard);
  assert.equal(resultCard.id, "card");
  assert.equal(resultCard.templateId, "different-forward");
  assert.deepEqual(resultCard.schedule, workspace.areas[0]?.cards[0]?.schedule);
  assert.equal(result.reviewEvents, workspace.reviewEvents);
});
void test("field loss is previewed and rejected until explicitly confirmed", () => {
  const workspace = initial();
  const type = {
    ...BASIC_NOTE_TYPE,
    fields: [{ name: "Front" }],
    templates: [{ id: "forward", name: "Forward", front: "{{Front}}", back: "Fixed answer" }],
  };
  const changed = { ...note, fields: { Front: "Question" } };
  const migration = { fields: {}, templates: {}, confirmRemoval: false };
  const area = workspace.areas[0];
  assert.ok(area);
  const impact = Effect.runSync(previewNoteMigration(area, type, changed, migration));
  assert.equal(impact.discardedValues[0]?.value, "Answer");
  const result = Effect.runSync(
    Effect.either(
      saveStudyNote(workspace, { areaId, type, note: changed, cardIds: [], migration }, now),
    ),
  );
  assert.ok(Either.isLeft(result));
  const confirmed = Effect.runSync(
    saveStudyNote(
      workspace,
      {
        areaId,
        type,
        note: changed,
        cardIds: [],
        migration: { ...migration, confirmRemoval: true },
      },
      now,
    ),
  );
  assert.equal(confirmed.areas[0]?.cards[0]?.id, "card");
});
void test("discarded sibling cards enter recoverable trash and retain their original identity", () => {
  const workspace = initial();
  const area = workspace.areas[0];
  assert.ok(area);
  const command = Effect.runSync(
    prepareNoteSave(
      area,
      REVERSED_NOTE_TYPE,
      { ...note, typeId: REVERSED_NOTE_TYPE.id },
      () => "reverse",
      { fields: {}, templates: { forward: "forward", reverse: "" }, confirmRemoval: false },
    ),
  );
  const expanded = Effect.runSync(saveStudyNote(workspace, command, now));
  const firstTemplate = REVERSED_NOTE_TYPE.templates[0];
  assert.ok(firstTemplate);
  const narrowed = save(
    expanded,
    { ...REVERSED_NOTE_TYPE, templates: [firstTemplate] },
    { ...note, typeId: REVERSED_NOTE_TYPE.id },
    { fields: {}, templates: {}, confirmRemoval: true },
  );
  assert.equal(narrowed.deletedCards?.[0]?.cardId, "reverse");
});
