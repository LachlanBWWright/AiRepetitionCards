import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either, Schema } from "effect";
import { KnowledgeAreaSchema, type KnowledgeArea } from "@recall/domain";
import { applySelectedDeckUpdate, diffKnowledgeAreas, previewRelease } from "@recall/application";
const type = {
  id: "type",
  name: "Two ways",
  fields: [{ name: "Front" }, { name: "Back" }],
  templates: [
    { id: "forward", name: "Forward", front: "{{Front}}", back: "{{Back}}" },
    { id: "reverse", name: "Reverse", front: "{{Back}}", back: "{{Front}}" },
  ],
};
function document(): KnowledgeArea {
  return Effect.runSync(
    Schema.decodeUnknown(KnowledgeAreaSchema)({
      schemaVersion: "1.0.0",
      id: "upstream",
      title: "Deck",
      description: null,
      language: "en",
      ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
      objectives: [
        {
          id: "objective",
          sourceId: "goal",
          title: "Goal",
          description: null,
          prerequisiteIds: [],
        },
      ],
      tags: [],
      licence: null,
      noteLibrary: {
        types: [type],
        notes: [
          {
            id: "note",
            typeId: "type",
            fields: { Front: "Question", Back: "Answer" },
            tags: [],
            objectiveIds: ["objective"],
          },
        ],
      },
      cards: [
        {
          id: "forward",
          kind: "basic",
          tags: [],
          origin: "imported",
          noteId: "note",
          templateId: "forward",
          front: "Question",
          back: "Answer",
          objectiveIds: ["objective"],
        },
        {
          id: "reverse",
          kind: "basic",
          tags: [],
          origin: "imported",
          noteId: "note",
          templateId: "reverse",
          front: "Answer",
          back: "Question",
          objectiveIds: ["objective"],
        },
      ],
    }),
  );
}
function fork(base: KnowledgeArea): KnowledgeArea {
  return Effect.runSync(
    Schema.decodeUnknown(KnowledgeAreaSchema)({
      ...base,
      id: "personal",
      sourceId: base.id,
      objectives: base.objectives.map((item) => ({ ...item, id: "local-objective" })),
      cards: base.cards.map((item) => ({
        ...item,
        id: `local-${item.id}`,
        sourceId: item.id,
        objectiveIds: ["local-objective"],
      })),
      noteLibrary: {
        ...base.noteLibrary,
        notes: base.noteLibrary?.notes.map((note) => ({
          ...note,
          objectiveIds: ["local-objective"],
        })),
      },
    }),
  );
}
function changed(base: KnowledgeArea): KnowledgeArea {
  return Effect.runSync(
    Schema.decodeUnknown(KnowledgeAreaSchema)({
      ...base,
      noteLibrary: {
        ...base.noteLibrary,
        notes: base.noteLibrary?.notes.map((note) => ({
          ...note,
          fields: { ...note.fields, Front: "Updated question" },
        })),
      },
      cards: base.cards.map((card) =>
        card.kind === "basic"
          ? {
              ...card,
              front: card.id === "forward" ? "Updated question" : card.front,
              back: card.id === "reverse" ? "Updated question" : card.back,
            }
          : card,
      ),
    }),
  );
}
const apply = (
  baseline: KnowledgeArea,
  current: unknown,
  upstream: unknown,
  selectedSourceIds: readonly string[],
  confirmedConflictSourceIds: readonly string[] = [],
  newIds: Readonly<Record<string, string>> = {},
) =>
  Effect.runSync(
    Effect.either(
      applySelectedDeckUpdate({
        baseline,
        current,
        upstream,
        selectedSourceIds,
        confirmedConflictSourceIds,
        newIds,
      }),
    ),
  );
await test("upstream note families update atomically and remap shared objectives", () => {
  const base = document(),
    current = fork(base),
    upstream = changed(base);
  const partial = apply(base, current, upstream, ["forward"], ["forward"]);
  assert.ok(Either.isLeft(partial));
  assert.equal(partial.left.reason, "local-conflict");
  const result = apply(base, current, upstream, ["forward", "reverse"]);
  assert.ok(Either.isRight(result));
  assert.equal(result.right.area.noteLibrary?.notes[0]?.fields.Front, "Updated question");
  assert.deepEqual(result.right.area.noteLibrary.notes[0].objectiveIds, ["local-objective"]);
  assert.deepEqual(
    result.right.area.cards.map((card) => card.id),
    ["local-forward", "local-reverse"],
  );
});
await test("new upstream note cards bring their note and type while preserving local-only library content", () => {
  const base = document(),
    original = fork(base);
  const local = {
    ...original,
    noteLibrary: {
      types: [
        ...(original.noteLibrary?.types ?? []),
        { ...type, id: "personal-type", name: "Personal type" },
      ],
      notes: [
        ...(original.noteLibrary?.notes ?? []),
        {
          id: "personal-note",
          typeId: "personal-type",
          fields: { Front: "Mine", Back: "Mine" },
          tags: [],
          objectiveIds: [],
        },
      ],
    },
  };
  const upstream = {
    ...base,
    noteLibrary: {
      types: [...(base.noteLibrary?.types ?? []), { ...type, id: "new-type", name: "New type" }],
      notes: [
        ...(base.noteLibrary?.notes ?? []),
        {
          id: "new-note",
          typeId: "new-type",
          fields: { Front: "New", Back: "Answer" },
          tags: [],
          objectiveIds: base.objectives.map((item) => item.id),
        },
      ],
    },
    cards: [
      ...base.cards,
      {
        ...base.cards[0],
        id: "new-forward",
        kind: "basic" as const,
        noteId: "new-note",
        templateId: "forward",
        front: "New",
        back: "Answer",
        objectiveIds: base.objectives.map((item) => item.id),
      },
    ],
  };
  const result = apply(base, local, upstream, ["new-forward"], [], {
    "new-forward": "personal-new-forward",
  });
  assert.ok(Either.isRight(result));
  assert.deepEqual(
    result.right.area.noteLibrary?.notes.map((note) => note.id),
    ["note", "personal-note", "new-note"],
  );
  assert.deepEqual(
    result.right.area.noteLibrary.types.map((type) => type.id),
    ["type", "personal-type", "new-type"],
  );
  assert.deepEqual(result.right.area.noteLibrary.notes.at(-1)?.objectiveIds, ["local-objective"]);
});
await test("local shared-note and type edits require explicit family confirmation", () => {
  const base = document(),
    current = fork(base),
    upstream = changed(base);
  const local = {
    ...current,
    noteLibrary: {
      types: (current.noteLibrary?.types ?? []).map((type) => ({
        ...type,
        name: "Personal template name",
      })),
      notes: (current.noteLibrary?.notes ?? []).map((note) => ({
        ...note,
        fields: { ...note.fields, Front: "Personal question" },
      })),
    },
  };
  const rejected = apply(base, local, upstream, ["forward", "reverse"]);
  assert.ok(Either.isLeft(rejected));
  assert.equal(rejected.left.reason, "local-conflict");
  const accepted = apply(base, local, upstream, ["forward", "reverse"], ["forward", "reverse"]);
  assert.ok(Either.isRight(accepted));
  assert.equal(accepted.right.area.noteLibrary?.types[0]?.name, type.name);
  assert.deepEqual(accepted.right.locallyModifiedSourceIds, ["forward", "reverse"]);
});
await test("type updates affecting local-only notes fail even after conflict confirmation", () => {
  const base = document(),
    current = fork(base);
  const local = {
    ...current,
    noteLibrary: {
      ...current.noteLibrary,
      types: current.noteLibrary?.types ?? [],
      notes: [
        ...(current.noteLibrary?.notes ?? []),
        {
          id: "personal-note",
          typeId: "type",
          fields: { Front: "Mine", Back: "Mine" },
          tags: [],
          objectiveIds: [],
        },
      ],
    },
  };
  const upstream = {
    ...base,
    noteLibrary: {
      ...base.noteLibrary,
      notes: base.noteLibrary?.notes ?? [],
      types: [{ ...type, name: "Upstream renamed" }],
    },
  };
  const result = apply(base, local, upstream, ["forward", "reverse"], ["forward", "reverse"]);
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, "local-conflict");
});
await test("note and template-only changes appear in card choices and release metadata", () => {
  const base = document();
  const upstream = {
    ...base,
    noteLibrary: {
      ...base.noteLibrary,
      notes: base.noteLibrary?.notes ?? [],
      types: [{ ...type, name: "Renamed type" }],
    },
  };
  const diff = Effect.runSync(diffKnowledgeAreas({ baseline: base, candidate: upstream }));
  assert.equal(diff.cards.changed.length, 2);
  assert.equal(
    diff.metadata.some((change) => change.field === "noteLibrary"),
    true,
  );
  const preview = Effect.runSync(previewRelease(base, upstream));
  assert.equal(
    preview.warnings.some((warning) => warning.includes("Shared note/template")),
    true,
  );
});
await test("unrendered note/type-only changes are explicitly fenced rather than silently dropped", () => {
  const base = document(),
    current = fork(base);
  const upstream = {
    ...base,
    noteLibrary: {
      notes: base.noteLibrary?.notes ?? [],
      types: [type, { ...type, id: "unused", name: "Unused" }],
    },
  };
  const result = apply(base, current, upstream, ["forward", "reverse"], ["forward", "reverse"]);
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, "local-conflict");
});
