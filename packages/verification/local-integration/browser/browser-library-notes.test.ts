import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { emptyLibraryNotes, retainLibraryDraft, toggleCardFlag } from "@recall/application";
import {
  createBrowserLibraryNotesStore,
  readDurableLibraryNotesPreference,
  readDraftFile,
  retainDraftFile,
  writeDurableLibraryNotesPreference,
} from "../../../../apps/web/src/lib/library-notes-store";
import { volatileStorage } from "../../../../apps/web/src/lib/volatile-storage";
import { createBrowserReleaseDraftStore } from "../../../../apps/web/src/lib/publishing/release-draft-store";
import {
  coordinateLocalErasure,
  setReviewWritePending,
} from "../../../../apps/web/src/features/workspace/local-write-coordinator";

class FakeStorage implements Storage {
  private readonly values = new Map<string, string>();
  failWrites = false;

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("Storage quota exceeded");
    this.values.set(key, value);
  }
}

function installFakeStorage(storage: FakeStorage) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

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

await test("browser notes stay tab-only unless the account owner explicitly enables durable storage", async () => {
  const storage = new FakeStorage();
  const restoreWindow = installFakeStorage(storage);
  volatileStorage.removeItem("recall-library-notes:tab-owner");
  try {
    const notes = toggleCardFlag(emptyLibraryNotes, "tab-only-card");
    const tabStore = createBrowserLibraryNotesStore("tab-owner");
    assert.ok(Either.isRight(await Effect.runPromise(Effect.either(tabStore.write(notes)))));
    assert.equal(storage.getItem("recall-library-notes:tab-owner"), null);
    assert.equal(readDurableLibraryNotesPreference("tab-owner"), false);

    assert.equal(writeDurableLibraryNotesPreference("tab-owner", true), true);
    assert.equal(readDurableLibraryNotesPreference("tab-owner"), true);
    assert.equal(storage.getItem("recall-library-notes:tab-owner"), JSON.stringify(notes));
    const releaseDrafts = createBrowserReleaseDraftStore(true, () =>
      readDurableLibraryNotesPreference("tab-owner"),
    );
    await Effect.runPromise(
      releaseDrafts.write("tab-owner--last-release:area", "private baseline"),
    );
    assert.equal(
      storage.getItem("recall-release-draft:tab-owner--last-release:area"),
      "private baseline",
    );
    volatileStorage.removeItem("recall-library-notes:tab-owner");
    const reloaded = createBrowserLibraryNotesStore("tab-owner", false, { durable: true });
    assert.deepEqual(await Effect.runPromise(reloaded.read), notes);
    assert.equal(volatileStorage.getItem("recall-library-notes:tab-owner"), JSON.stringify(notes));

    assert.equal(writeDurableLibraryNotesPreference("tab-owner", false), true);
    assert.equal(storage.getItem("recall-library-notes:tab-owner"), null);
    assert.equal(storage.getItem("recall-release-draft:tab-owner--last-release:area"), null);
    assert.equal(readDurableLibraryNotesPreference("tab-owner"), false);
    await Effect.runPromise(
      releaseDrafts.write("tab-owner--last-release:area", "stale queued write"),
    );
    assert.equal(storage.getItem("recall-release-draft:tab-owner--last-release:area"), null);
    assert.equal(
      volatileStorage.getItem("recall-release-draft:tab-owner--last-release:area"),
      "stale queued write",
    );
    assert.deepEqual(await Effect.runPromise(tabStore.read), notes);
    assert.ok(
      Either.isLeft(
        await Effect.runPromise(Effect.either(reloaded.write(toggleCardFlag(notes, "late-write")))),
      ),
    );
    assert.equal(storage.getItem("recall-library-notes:tab-owner"), null);
  } finally {
    volatileStorage.removeItem("recall-library-notes:tab-owner");
    volatileStorage.removeItem("recall-release-draft:tab-owner--last-release:area");
    restoreWindow();
  }
});

await test("durable notes and preference removal stay scoped to their owner", async () => {
  const storage = new FakeStorage();
  const restoreWindow = installFakeStorage(storage);
  try {
    const first = toggleCardFlag(emptyLibraryNotes, "first-card");
    const second = toggleCardFlag(emptyLibraryNotes, "second-card");
    assert.equal(writeDurableLibraryNotesPreference("first-owner", true), true);
    assert.equal(writeDurableLibraryNotesPreference("second-owner", true), true);
    const firstStore = createBrowserLibraryNotesStore("first-owner", false, { durable: true });
    const secondStore = createBrowserLibraryNotesStore("second-owner", false, { durable: true });
    assert.ok(Either.isRight(await Effect.runPromise(Effect.either(firstStore.write(first)))));
    assert.ok(Either.isRight(await Effect.runPromise(Effect.either(secondStore.write(second)))));
    assert.equal(writeDurableLibraryNotesPreference("first-owner", false), true);
    assert.equal(storage.getItem("recall-library-notes:first-owner"), null);
    assert.equal(storage.getItem("recall-library-notes-durable:first-owner"), null);
    assert.equal(storage.getItem("recall-library-notes:second-owner"), JSON.stringify(second));
    assert.equal(readDurableLibraryNotesPreference("second-owner"), true);
  } finally {
    restoreWindow();
  }
});

await test("explicit local erasure removes durable private prefixes and preserves unrelated storage", async () => {
  const storage = new FakeStorage();
  const restoreWindow = installFakeStorage(storage);
  try {
    assert.equal(writeDurableLibraryNotesPreference("erase-durable-owner", true), true);
    const owner = createBrowserLibraryNotesStore("erase-durable-owner", false, { durable: true });
    assert.ok(
      Either.isRight(await Effect.runPromise(Effect.either(owner.write(emptyLibraryNotes)))),
    );
    assert.equal(writeDurableLibraryNotesPreference("erase-durable-owner", true), true);
    storage.setItem("recall-release-draft:owner--area", "private baseline");
    storage.setItem("unrelated-application-setting", "keep");

    volatileStorage.clear();
    assert.equal(storage.getItem("recall-library-notes:erase-durable-owner"), null);
    assert.equal(storage.getItem("recall-library-notes-durable:erase-durable-owner"), null);
    assert.equal(storage.getItem("recall-release-draft:owner--area"), null);
    assert.equal(storage.getItem("unrelated-application-setting"), "keep");
  } finally {
    restoreWindow();
  }
});

await test("durable writes reject invalid data, oversized values, and storage quota failures", async () => {
  const storage = new FakeStorage();
  const restoreWindow = installFakeStorage(storage);
  try {
    assert.equal(writeDurableLibraryNotesPreference("bounded-owner", true), true);
    const store = createBrowserLibraryNotesStore("bounded-owner", false, { durable: true });
    const invalid = await Effect.runPromise(
      Effect.either(store.write({ version: 1, drafts: [{ kind: "card" }], flaggedCardIds: [] })),
    );
    assert.ok(Either.isLeft(invalid));
    const largeNotes = {
      ...emptyLibraryNotes,
      flaggedCardIds: Array.from(
        { length: 100_000 },
        (_, index) => `flagged-${String(index)}-${"x".repeat(48)}`,
      ),
    };
    assert.ok(Either.isLeft(await Effect.runPromise(Effect.either(store.write(largeNotes)))));
    storage.failWrites = true;
    assert.ok(
      Either.isLeft(await Effect.runPromise(Effect.either(store.write(emptyLibraryNotes)))),
    );
    assert.equal(readDurableLibraryNotesPreference("bounded-owner"), true);
  } finally {
    restoreWindow();
  }
});

await test("hosted sync failures distinguish conflicts from unavailable services", async () => {
  const storage = new FakeStorage();
  const restoreWindow = installFakeStorage(storage);
  const previousFetch = globalThis.fetch;
  try {
    const notes = {
      ...emptyLibraryNotes,
      activityLibrary: { version: 1, activities: [], attempts: [] } as const,
    };
    assert.equal(writeDurableLibraryNotesPreference("conflict-owner", true), true);
    assert.equal(writeDurableLibraryNotesPreference("offline-status-owner", true), true);
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "Concurrent update" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      );
    const conflicted = createBrowserLibraryNotesStore("conflict-owner", true, { durable: true });
    const conflictWrite = await Effect.runPromise(Effect.either(conflicted.write(notes)));
    assert.ok(Either.isLeft(conflictWrite));
    assert.equal(
      Either.isLeft(conflictWrite) ? conflictWrite.left.recovery : undefined,
      "conflicted",
    );
    assert.equal(conflicted.persistenceStatus?.(), "conflicted");
    assert.deepEqual(
      JSON.parse(storage.getItem("recall-library-notes:conflict-owner") ?? "null"),
      notes,
    );

    globalThis.fetch = () => Promise.reject(new Error("offline"));
    const offline = createBrowserLibraryNotesStore("offline-status-owner", true, { durable: true });
    const offlineWrite = await Effect.runPromise(Effect.either(offline.write(notes)));
    assert.ok(Either.isLeft(offlineWrite));
    assert.equal(
      Either.isLeft(offlineWrite) ? offlineWrite.left.recovery : undefined,
      "awaiting-sync",
    );
    assert.equal(offline.persistenceStatus?.(), "awaiting-sync");
    assert.deepEqual(
      JSON.parse(storage.getItem("recall-library-notes:offline-status-owner") ?? "null"),
      notes,
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreWindow();
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
