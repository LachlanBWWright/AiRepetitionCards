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
import { createBrowserLibraryNotesStore } from "../../../../apps/web/src/lib/library-notes-store";

await test("hosted writes return their committed cloud merge and preserve it in a subsequent offline write", async () => {
  const activity = (id: string) =>
    Effect.runSync(
      authorLearningActivity({
        id,
        areaId: "deck",
        title: id,
        pluginId: "recall.multiple-choice",
        objectiveId: "objective",
        fields: { prompt: "Choose A.", options: "A\nB", correct: "1", reference: "A is correct." },
      }),
    );
  const local = activity("local");
  const remote = activity("remote");
  const submitted: LibraryNotes = {
    ...emptyLibraryNotes,
    activityLibrary: { ...emptyActivityLibrary, activities: [local] },
  };
  const merged = { ...emptyActivityLibrary, activities: [local, remote] };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (_request, options) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          revision: options?.method === "POST" ? 2 : 1,
          library:
            options?.method === "POST" ? merged : { ...emptyActivityLibrary, activities: [remote] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  try {
    const store = createBrowserLibraryNotesStore("committed-merge-owner", true);
    const committed = await Effect.runPromise(store.write(submitted));
    assert.ok(committed);
    assert.deepEqual(committed.activityLibrary, merged);
    const current = Effect.runSync(reconcileLibraryNotesWrite(submitted, submitted, committed));
    globalThis.fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ error: "Offline" }), { status: 503 }));
    const saved = await Effect.runPromise(
      Effect.either(store.write({ ...current, flaggedCardIds: ["new-flag"] })),
    );
    assert.ok(Either.isLeft(saved));
    const retained = await Effect.runPromise(createBrowserLibraryNotesStore(store.scope).read);
    assert.deepEqual(retained.activityLibrary, current.activityLibrary);
    assert.deepEqual(retained.flaggedCardIds, ["new-flag"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
