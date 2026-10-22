import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { createAreaId, type Workspace } from "@recall/domain";
import {
  BASIC_NOTE_TYPE,
  CLOZE_NOTE_TYPE,
  REVERSED_NOTE_TYPE,
  expandCloze,
  clozeAnswerText,
  previewStudyNote,
  saveStudyNote,
  updateStudyCard,
} from "@recall/application";
const now = new Date("2026-10-20T00:00:00Z");
const areaId = createAreaId("notes-subject");
const initial: Workspace = {
  schemaVersion: 1,
  reviews: 0,
  areas: [{ id: areaId, title: "Notes", color: "#112233", cards: [] }],
};
const note = {
  id: "note-one",
  typeId: "basic-reversed",
  fields: { Front: "Question", Back: "Answer" },
  tags: [],
  objectiveIds: [],
};
const ids = [
  { templateId: "forward", cardId: "notes-forward" },
  { templateId: "reverse", cardId: "notes-reverse" },
];
function success<A, E>(operation: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}
void test("shared source generates reciprocal cards and preserves schedules and content versions on edit", () => {
  const workspace = success(
    saveStudyNote(initial, { areaId, type: REVERSED_NOTE_TYPE, note, cardIds: ids }, now),
  );
  const cards = workspace.areas[0]?.cards ?? [];
  assert.deepEqual(
    cards.map((card) => [card.front, card.back]),
    [
      ["Question", "Answer"],
      ["Answer", "Question"],
    ],
  );
  const updated = success(
    saveStudyNote(
      workspace,
      { areaId, note: { ...note, fields: { Front: "Changed", Back: "Answer" } }, cardIds: [] },
      now,
    ),
  );
  assert.deepEqual(
    updated.areas[0]?.cards.map((card) => card.schedule),
    cards.map((card) => card.schedule),
  );
  assert.equal(updated.cardVersions?.length, 2);
  assert.equal(updated.areas[0].cards[1]?.back, "Changed");
  const direct = Effect.runSync(
    Effect.either(
      updateStudyCard(
        updated,
        {
          areaId,
          cardId: "notes-forward",
          content: {
            kind: "basic",
            front: "Diverged",
            back: "Answer",
            objectiveIds: [],
            tags: [],
            media: [],
          },
        },
        now,
      ),
    ),
  );
  assert.ok(Either.isLeft(direct));
});
void test("removing a template preserves deleted card evidence; a new template needs a fresh identity", () => {
  const workspace = success(
    saveStudyNote(initial, { areaId, type: REVERSED_NOTE_TYPE, note, cardIds: ids }, now),
  );
  const updated = success(
    saveStudyNote(
      workspace,
      {
        areaId,
        type: { ...BASIC_NOTE_TYPE, id: note.typeId },
        note,
        cardIds: [],
        migration: { fields: {}, templates: {}, confirmRemoval: true },
      },
      now,
    ),
  );
  assert.equal(updated.areas[0]?.cards.length, 1);
  assert.equal(updated.deletedCards?.[0]?.cardId, "notes-reverse");
  assert.ok(updated.cardVersions?.some((version) => version.cardId === "notes-reverse"));
  const collision = Effect.runSync(
    Effect.either(
      saveStudyNote(updated, { areaId, type: REVERSED_NOTE_TYPE, note, cardIds: ids }, now),
    ),
  );
  assert.ok(Either.isLeft(collision));
});
void test("nested cloze renders selected inner and outer deletions and rejects malformed nesting", () => {
  const cards = success(expandCloze("{{c1::A {{c2::nested::hint}} answer}}"));
  assert.deepEqual(
    cards.map((card) => card.front),
    ["[...]", "A [hint] answer"],
  );
  assert.deepEqual(
    cards.map((card) => card.back),
    ["A nested answer", "A nested answer"],
  );
  assert.ok(Either.isLeft(Effect.runSync(Effect.either(expandCloze("{{c1::bad {{c2::nest}}")))));
});
void test("linked cloze edits retain surviving deletion identity and retire removed deletion", () => {
  const clozeNote = { ...note, typeId: "cloze", fields: { Text: "{{c1::one}} {{c2::two}}" } };
  const workspace = success(
    saveStudyNote(
      initial,
      {
        areaId,
        type: CLOZE_NOTE_TYPE,
        note: clozeNote,
        cardIds: [
          { templateId: "cloze", deletionIndex: 1, cardId: "cloze-one" },
          { templateId: "cloze", deletionIndex: 2, cardId: "cloze-two" },
        ],
      },
      now,
    ),
  );
  const updated = success(
    saveStudyNote(
      workspace,
      {
        areaId,
        note: { ...clozeNote, fields: { Text: "{{c2::two changed}}" } },
        cardIds: [],
        migration: { fields: {}, templates: {}, confirmRemoval: true },
      },
      now,
    ),
  );
  assert.equal(updated.areas[0]?.cards[0]?.id, "cloze-two");
  assert.equal(updated.areas[0].cards[0].back, "two changed");
  assert.equal(updated.deletedCards?.[0]?.cardId, "cloze-one");
});
void test("templates validate placeholders and never interpret script markup", () => {
  const invalid = {
    ...REVERSED_NOTE_TYPE,
    templates: [{ id: "bad", name: "Bad", front: "{{Unknown}}", back: "{{Back}}" }],
  };
  assert.ok(Either.isLeft(Effect.runSync(Effect.either(previewStudyNote(invalid, note)))));
  const cards = success(
    previewStudyNote(REVERSED_NOTE_TYPE, {
      ...note,
      fields: { Front: "<script>alert(1)</script>", Back: "text" },
    }),
  );
  assert.equal(cards[0]?.front, "<script>alert(1)</script>");
});

void test("typed cloze answers contain selected deletions without surrounding context", () => {
  assert.equal(
    success(
      clozeAnswerText({
        text: "A {{c1::nested {{c2::answer}}}} and {{c2::second}}",
        deletionIndex: 2,
      }),
    ),
    "answer, second",
  );
  assert.equal(
    success(clozeAnswerText({ text: "A {{c1::nested {{c2::answer}}}}", deletionIndex: 1 })),
    "nested answer",
  );
});

void test("template typing and pronunciation settings propagate to generated cards", () => {
  const presentation = {
    typedAnswer: { enabled: true, ignoreCase: true, ignoreAccents: false },
    speech: { back: { language: "fr-FR", rate: 0.75, autoplay: true } },
  };
  const type = {
    ...REVERSED_NOTE_TYPE,
    templates: REVERSED_NOTE_TYPE.templates.map((template) => ({ ...template, presentation })),
  };
  const workspace = success(saveStudyNote(initial, { areaId, type, note, cardIds: ids }, now));
  assert.deepEqual(
    workspace.areas[0]?.cards.map((card) => card.presentation),
    [presentation, presentation],
  );
  const cleared = success(
    saveStudyNote(workspace, { areaId, type: REVERSED_NOTE_TYPE, note, cardIds: [] }, now),
  );
  assert.equal(cleared.areas[0]?.cards[0]?.presentation, undefined);
  assert.deepEqual(cleared.areas[0]?.cards[0]?.schedule, workspace.areas[0].cards[0]?.schedule);
});
