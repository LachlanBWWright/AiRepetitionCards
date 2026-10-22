import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { browserNoteRows, createStudySearchIndex, searchStudyCards } from "@recall/application";
import { createAssessmentId, type Workspace } from "@recall/domain";
import { workspace, card, now } from "./fixtures";

function notesWorkspace(): Workspace {
  const initial = workspace();
  return {
    ...initial,
    areas: initial.areas.map((area) => ({
      ...area,
      cards: [
        { ...card("forward"), noteId: "n", templateId: "forward" },
        { ...card("reverse"), noteId: "n", templateId: "reverse" },
        card("independent"),
      ],
      noteLibrary: {
        types: [
          {
            id: "basic",
            name: "Basic reverse",
            fields: [{ name: "Extra" }],
            templates: [
              { id: "forward", name: "Forward", front: "{{Extra}}", back: "Answer" },
              { id: "reverse", name: "Reverse", front: "Answer", back: "{{Extra}}" },
            ],
          },
        ],
        notes: [
          {
            id: "n",
            typeId: "basic",
            fields: { Extra: "Mitochondria 42" },
            tags: [],
            objectiveIds: [],
          },
        ],
      },
    })),
  };
}
await test("indexed searches include source fields, note types and templates; notes mode deduplicates siblings", () => {
  const initial = notesWorkspace();
  const index = createStudySearchIndex(initial);
  const find = (query: string) =>
    Effect.runSync(searchStudyCards(initial, query, now, undefined, index));
  assert.equal(find("Mitochondria").length, 2);
  assert.equal(find('note:"Basic reverse" field:Extra:42').length, 2);
  assert.deepEqual(
    find("card:Reverse").map(({ card }) => card.id),
    ["reverse"],
  );
  assert.equal(browserNoteRows(find("")).length, 2);
  assert.equal(find('re:"^Mitochondria [0-9]+$"').length, 2);
});
await test("regular expression search rejects invalid and backtracking patterns explicitly", () => {
  for (const query of ['re:"(a+)+$"', 're:"a.*b.*c"', 're:"["', 're:"a|b"']) {
    const result = Effect.runSync(Effect.either(searchStudyCards(notesWorkspace(), query, now)));
    assert.ok(Either.isLeft(result), query);
  }
});
await test("indexed searches retain every result above the former 500-card boundary", () => {
  const initial = workspace();
  const large = {
    ...initial,
    areas: initial.areas.map((area) => ({
      ...area,
      cards: Array.from({ length: 2_001 }, (_, i) => ({
        ...card("entry"),
        id: createAssessmentId(`entry-${String(i)}`),
      })),
    })),
  };
  const index = createStudySearchIndex(large);
  assert.equal(Effect.runSync(searchStudyCards(large, "", now, undefined, index)).length, 2_001);
});

await test("source-note replacement updates each sibling atomically and retains schedules", async () => {
  const { replaceCardFields } =
    await import("../../../../application/src/review/search/card-browser");
  const initial = notesWorkspace();
  const area = initial.areas[0];
  assert.ok(area);
  const result = Effect.runSync(
    replaceCardFields(
      initial,
      {
        kind: "replace-card-fields",
        areaId: area.id,
        cardIds: area.cards.slice(0, 2).map((item) => item.id),
        field: "note",
        noteField: "Extra",
        find: "42",
        replacement: "43",
      },
      new Date(now),
    ),
  );
  const updated = result.areas[0];
  assert.ok(updated);
  const library = updated.noteLibrary;
  assert.ok(library);
  const note = library.notes[0];
  assert.ok(note);
  assert.equal(note.fields.Extra, "Mitochondria 43");
  assert.equal(updated.cards.find((item) => item.id === "forward")?.front, "Mitochondria 43");
  assert.deepEqual(
    updated.cards.find((item) => item.id === "reverse")?.schedule,
    area.cards[1]?.schedule,
  );
  assert.equal(initial.areas[0]?.noteLibrary?.notes[0]?.fields.Extra, "Mitochondria 42");
});
