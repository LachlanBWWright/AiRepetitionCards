import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { emptyLibraryNotes, retainLibraryDraft, toggleCardFlag } from "@recall/application";
import {
  createBrowserLibraryNotesStore,
  readDraftFile,
  retainDraftFile,
} from "../../../apps/web/src/lib/library-notes-store";
import { volatileStorage } from "../../../apps/web/src/lib/volatile-storage";
import {
  coordinateLocalErasure,
  setReviewWritePending,
} from "../../../apps/web/src/features/workspace/local-write-coordinator";

await test("drafts round trip by owner without entering the workspace and discarded files are released", async () => {
  const store = createBrowserLibraryNotesStore("draft-owner");
  const draft = {
    kind: "area",
    key: "new-area",
    mode: "create",
    id: "new",
    title: "",
    color: "#123456",
  } as const;
  const notes = toggleCardFlag(retainLibraryDraft(emptyLibraryNotes, draft), "flagged-card");
  const file = new File(["draft attachment"], "draft.txt");
  retainDraftFile(store.scope, draft.key, file);
  assert.ok(Either.isRight(await Effect.runPromise(Effect.either(store.write(notes)))));
  assert.deepEqual(await Effect.runPromise(store.read), notes);
  assert.deepEqual(
    await Effect.runPromise(createBrowserLibraryNotesStore("other-owner").read),
    emptyLibraryNotes,
  );
  assert.equal(readDraftFile(store.scope, draft.key), file);
  await Effect.runPromise(store.write(emptyLibraryNotes));
  assert.equal(readDraftFile(store.scope, draft.key), null);
});

await test("invalid external notes cannot overwrite the retained record and corrupt reads fail explicitly", async () => {
  const store = createBrowserLibraryNotesStore("invalid-owner");
  await Effect.runPromise(store.write(emptyLibraryNotes));
  const key = `recall-library-notes:${store.scope}`;
  const original = volatileStorage.getItem(key);
  const invalid = await Effect.runPromise(
    Effect.either(store.write({ version: 1, drafts: [{ kind: "card" }], flaggedCardIds: [] })),
  );
  assert.ok(Either.isLeft(invalid));
  assert.equal(volatileStorage.getItem(key), original);
  volatileStorage.setItem(key, "{broken");
  assert.ok(Either.isLeft(await Effect.runPromise(Effect.either(store.read))));
});

await test("hosted synchronization failures retain local activities and allow offline reads", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ error: "Unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
  try {
    const store = createBrowserLibraryNotesStore("offline-owner", true);
    assert.deepEqual(await Effect.runPromise(store.read), emptyLibraryNotes);
    const notes = {
      ...toggleCardFlag(emptyLibraryNotes, "flagged-offline-card"),
      activityLibrary: { version: 1, activities: [], attempts: [] } as const,
    };
    const saved = await Effect.runPromise(Effect.either(store.write(notes)));
    assert.ok(Either.isLeft(saved));
    assert.deepEqual(await Effect.runPromise(store.read), notes);
    assert.deepEqual(
      await Effect.runPromise(createBrowserLibraryNotesStore("offline-owner").read),
      notes,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

await test("pending reviews and local erasure fence draft writes so private data cannot reappear", async () => {
  const store = createBrowserLibraryNotesStore("erased-owner");
  await Effect.runPromise(store.write(emptyLibraryNotes));
  setReviewWritePending(true);
  const blocked = await Effect.runPromise(
    Effect.either(store.write(toggleCardFlag(emptyLibraryNotes, "card"))),
  );
  setReviewWritePending(false);
  assert.ok(Either.isLeft(blocked));
  assert.deepEqual(await Effect.runPromise(store.read), emptyLibraryNotes);
  await Effect.runPromise(
    coordinateLocalErasure(
      Effect.sync(() => {
        volatileStorage.clear();
        return true;
      }),
    ),
  );
  assert.ok(Either.isLeft(await Effect.runPromise(Effect.either(store.write(emptyLibraryNotes)))));
  assert.equal(volatileStorage.getItem(`recall-library-notes:${store.scope}`), null);
});
