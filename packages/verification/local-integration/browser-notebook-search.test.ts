import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either, Schema } from "effect";
import { createAreaId, type Workspace } from "@recall/domain";
import { KnowledgeNotebookSchema, type KnowledgeNotebook } from "@recall/application";
import { createBrowserKnowledgeNotebookStore } from "../../../apps/web/src/lib/knowledge-notebook-store";
import { loadBrowserWorkspaceSearchNotebooks } from "../../../apps/web/src/features/search/load-search-notebooks";
import {
  coordinateLocalErasure,
  localWritesBlocked,
  setReviewWritePending,
} from "../../../apps/web/src/features/workspace/local-write-coordinator";

const areaId = createAreaId("00000000-0000-4000-8000-000000000001");
const otherAreaId = createAreaId("00000000-0000-4000-8000-000000000002");
const notebookKey = (namespace: string, area: string = areaId) =>
  `recall-knowledge-notebook:${JSON.stringify([namespace, area])}`;
const workspace: Workspace = {
  schemaVersion: 1,
  reviews: 0,
  areas: [{ id: areaId, title: "Go programming", color: "#123456", cards: [] }],
};
function notebook(area: string = areaId, goal = "Learn Go concurrency"): KnowledgeNotebook {
  return Schema.decodeUnknownSync(KnowledgeNotebookSchema)({
    version: 1,
    areaId: area,
    goal,
    concepts: [],
    evidence: [],
    proposals: [],
    session: {
      phase: "idle",
      targetConceptId: null,
      pendingQuestion: null,
      mode: "diagnostic",
      askedQuestions: 0,
      maxQuestions: 20,
      maxRequests: 60,
      requestsUsed: 0,
      startedAt: null,
      maximumDurationMs: 3_600_000,
      skippedConceptIds: [],
    },
  });
}
async function success<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(Effect.either(operation));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}
async function rejected<A, E extends { readonly reason: string }>(
  operation: Effect.Effect<A, E>,
  reason: string,
): Promise<void> {
  const result = await Effect.runPromise(Effect.either(operation));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, reason);
}

/** Only the browser storage and lock ports are mocked; application/store code is real. */
function browserFixture() {
  const records = new Map<string, string>();
  const reads = new Map<string, number>();
  let lockRequests = 0;
  const storage = {
    getItem: (key: string) => {
      reads.set(key, (reads.get(key) ?? 0) + 1);
      return records.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      records.set(key, value);
    },
    removeItem: (key: string) => {
      records.delete(key);
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: storage,
      navigator: {
        locks: {
          request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => {
            lockRequests += 1;
            return await callback();
          },
        },
      },
      addEventListener: () => undefined,
    },
  });
  return {
    records,
    reads,
    get lockRequests() {
      return lockRequests;
    },
    restore: () => {
      setReviewWritePending(false);
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    },
  };
}

await test("browser notebook search indexes only requested namespaces and current areas, once per namespace", async () => {
  const fixture = browserFixture();
  try {
    fixture.records.set(notebookKey("hosted"), JSON.stringify(notebook()));
    fixture.records.set(
      notebookKey("desktop:user-a"),
      JSON.stringify(notebook(areaId, "Private account A")),
    );
    fixture.records.set(
      notebookKey("desktop:user-b"),
      JSON.stringify(notebook(areaId, "Private account B")),
    );
    fixture.records.set(notebookKey("hosted", otherAreaId), JSON.stringify(notebook(otherAreaId)));
    const loaded = await success(
      loadBrowserWorkspaceSearchNotebooks(workspace, ["hosted", "desktop:user-a", "hosted"]),
    );
    assert.deepEqual(
      loaded.notebooks.map((entry) => entry.namespace),
      ["hosted", "desktop:user-a"],
    );
    assert.equal(loaded.unreadableCount, 0);
    assert.equal(fixture.reads.get(notebookKey("hosted")), 1);
    assert.equal(fixture.reads.get(notebookKey("desktop:user-a")), 1);
    assert.equal(fixture.reads.has(notebookKey("desktop:user-b")), false);
    assert.equal(fixture.reads.has(notebookKey("hosted", otherAreaId)), false);
    assert.equal(fixture.lockRequests, 2);
  } finally {
    fixture.restore();
  }
});

await test("search preserves healthy notebooks and counts invalid JSON, schema and mismatched area records", async () => {
  const fixture = browserFixture();
  try {
    const invalid = new Map([
      [notebookKey("bad-json"), "{unfinished"],
      [notebookKey("bad-schema"), JSON.stringify({ version: 1 })],
      [notebookKey("wrong-area"), JSON.stringify(notebook(otherAreaId))],
    ]);
    for (const [key, value] of invalid) fixture.records.set(key, value);
    fixture.records.set(notebookKey("healthy"), JSON.stringify(notebook()));
    const loaded = await success(
      loadBrowserWorkspaceSearchNotebooks(workspace, [
        "healthy",
        "bad-json",
        "bad-schema",
        "wrong-area",
        "missing",
      ]),
    );
    assert.equal(loaded.notebooks.length, 1);
    assert.equal(loaded.notebooks[0]?.namespace, "healthy");
    assert.equal(loaded.unreadableCount, 3);
    for (const [key, value] of invalid) assert.equal(fixture.records.get(key), value);
    assert.equal(fixture.records.has(notebookKey("missing")), false);
    const empty = await success(
      loadBrowserWorkspaceSearchNotebooks({ ...workspace, areas: [] }, ["healthy"]),
    );
    assert.deepEqual(empty, { notebooks: [], unreadableCount: 0 });
  } finally {
    fixture.restore();
  }
});

await test("notebook stores require a successful read and fence stale writes and clears across instances", async () => {
  const fixture = browserFixture();
  try {
    const first = createBrowserKnowledgeNotebookStore("hosted", areaId);
    const second = createBrowserKnowledgeNotebookStore("hosted", areaId);
    await rejected(first.write(notebook()), "unavailable");
    await rejected(first.clear(), "unavailable");
    assert.equal(await success(first.read()), null);
    assert.equal(await success(second.read()), null);
    await success(first.write(notebook()));
    await rejected(second.write(notebook(areaId, "Stale competing draft")), "stale");
    await rejected(second.clear(), "stale");
    assert.equal((await success(second.read()))?.goal, "Learn Go concurrency");
    await success(second.write(notebook(areaId, "Latest draft")));
    await rejected(first.clear(), "stale");
    assert.equal((await success(first.read()))?.goal, "Latest draft");
    await success(first.clear());
    await rejected(second.write(notebook()), "stale");
    assert.equal(await success(second.read()), null);
    await success(second.write(notebook(areaId, "Recreated notebook")));
    assert.equal((await success(first.read()))?.goal, "Recreated notebook");
    await rejected(first.write(notebook(otherAreaId)), "invalid");
    assert.equal(
      fixture.records.get(notebookKey("hosted")),
      JSON.stringify(notebook(areaId, "Recreated notebook")),
    );
  } finally {
    fixture.restore();
  }
});

await test("pending review blocks search/store mutations and cleanup permanently fences old notebook views", async () => {
  const fixture = browserFixture();
  try {
    const store = createBrowserKnowledgeNotebookStore("hosted", areaId);
    await success(store.read());
    await success(store.write(notebook()));
    setReviewWritePending(true);
    await rejected(store.write(notebook(areaId, "Blocked draft")), "unavailable");
    await rejected(store.clear(), "unavailable");
    const blockedSearch = await success(loadBrowserWorkspaceSearchNotebooks(workspace, ["hosted"]));
    assert.deepEqual(blockedSearch, { notebooks: [], unreadableCount: 1 });
    setReviewWritePending(false);
    assert.equal((await success(store.read()))?.goal, "Learn Go concurrency");
    const failedCleanup = await success(coordinateLocalErasure(Effect.succeed(false)));
    assert.equal(failedCleanup, false);
    assert.equal(localWritesBlocked(), true);
    assert.equal(
      fixture.records.get("recall-local-data-epoch"),
      JSON.stringify({ epoch: 1, erasing: true }),
    );
    assert.equal(fixture.records.has(notebookKey("hosted")), true);
    await rejected(store.read(), "unavailable");
    await rejected(store.write(notebook()), "unavailable");
    const erased = await success(
      coordinateLocalErasure(
        Effect.sync(() => {
          fixture.records.delete(notebookKey("hosted"));
          return true;
        }),
      ),
    );
    assert.equal(erased, true);
    assert.equal(localWritesBlocked(), true);
    assert.equal(
      fixture.records.get("recall-local-data-epoch"),
      JSON.stringify({ epoch: 2, erasing: false }),
    );
    await rejected(store.read(), "unavailable");
    await rejected(store.write(notebook()), "unavailable");
    await rejected(store.clear(), "unavailable");
    assert.equal(fixture.records.has(notebookKey("hosted")), false);
  } finally {
    fixture.restore();
  }
});
