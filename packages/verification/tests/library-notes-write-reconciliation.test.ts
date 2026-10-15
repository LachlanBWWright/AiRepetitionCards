import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { emptyActivityLibrary } from "@recall/domain";
import {
  authorLearningActivity,
  emptyLibraryNotes,
  reconcileLibraryNotesWrite,
  type LibraryNotes,
} from "@recall/application";

const activity = (id: string) =>
  Effect.runSync(
    authorLearningActivity({
      id,
      areaId: "deck",
      title: id,
      pluginId: "recall.multiple-choice",
      objectiveId: "objective",
      fields: { prompt: "Which is correct?", options: "A\nB", correct: "1", reference: "A" },
    }),
  );
const submitted: LibraryNotes = {
  ...emptyLibraryNotes,
  activityLibrary: { ...emptyActivityLibrary, activities: [activity("local")] },
};
const committed: LibraryNotes = {
  ...submitted,
  activityLibrary: { ...emptyActivityLibrary, activities: [activity("local"), activity("remote")] },
};

await test("committed cloud additions become the next offline write input", () => {
  const next = Effect.runSync(reconcileLibraryNotesWrite(submitted, submitted, committed));
  assert.deepEqual(
    next.activityLibrary?.activities.map((entry) => entry.id),
    ["local", "remote"],
  );
  const offline = Effect.runSync(reconcileLibraryNotesWrite(next, next, undefined));
  assert.deepEqual(offline.activityLibrary, next.activityLibrary);
});

await test("cloud completion preserves newer edits, flags, and discarded editor drafts", () => {
  const editor = {
    id: "editor",
    areaId: "deck",
    title: "Draft",
    pluginId: "recall.multiple-choice",
    objectiveId: "objective",
    fields: {},
    updatedAt: "2026-10-13T10:00:00.000Z",
  };
  const before: LibraryNotes = {
    ...submitted,
    activityLibrary: {
      ...emptyActivityLibrary,
      activities: [activity("local")],
      editorDrafts: [editor],
    },
  };
  const local = activity("local");
  const current: LibraryNotes = {
    ...before,
    flaggedCardIds: ["flagged-while-uploading"],
    activityLibrary: {
      ...emptyActivityLibrary,
      activities: [{ ...local, title: "Edited while uploading", revision: 2 }],
      editorDrafts: [],
    },
  };
  const next = Effect.runSync(
    reconcileLibraryNotesWrite(before, current, {
      ...committed,
      activityLibrary: {
        ...emptyActivityLibrary,
        activities: [activity("local"), activity("remote")],
        editorDrafts: [editor],
      },
    }),
  );
  assert.ok(next.activityLibrary);
  assert.equal(
    next.activityLibrary.activities.find((entry) => entry.id === "local")?.title,
    "Edited while uploading",
  );
  assert.deepEqual(next.activityLibrary.editorDrafts, []);
  assert.deepEqual(next.flaggedCardIds, current.flaggedCardIds);
  assert.equal(next.activityLibrary.activities.length, 2);
});

await test("a cleared library is not resurrected by an in-flight committed result", () => {
  const cleared = { ...emptyLibraryNotes, flaggedCardIds: ["new-flag"] };
  assert.deepEqual(
    Effect.runSync(reconcileLibraryNotesWrite(submitted, cleared, committed)),
    cleared,
  );
});

await test("conflicting additions remain an expected failure without replacing newer local state", () => {
  const remote = activity("remote");
  const current: LibraryNotes = {
    ...submitted,
    activityLibrary: {
      ...emptyActivityLibrary,
      activities: [activity("local"), { ...remote, title: "Different local addition" }],
    },
  };
  const result = Effect.runSync(
    Effect.either(reconcileLibraryNotesWrite(submitted, current, committed)),
  );
  assert.ok(Either.isLeft(result));
  assert.equal(result.left._tag, "LibraryNotesFailure");
  assert.equal(current.activityLibrary?.activities[1]?.title, "Different local addition");
});
