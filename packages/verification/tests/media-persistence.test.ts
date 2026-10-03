import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Deferred, Effect, Either, Schema } from "effect";
import {
  MediaIdSchema,
  createAreaId,
  createCardId,
  parseWorkspaceJson,
  type Workspace,
} from "@recall/domain";
import { persistMediaAssets, saveWorkspaceWithMedia } from "@recall/application";
import { newSchedule } from "@recall/scheduler";

type WorkspaceStore = Parameters<typeof saveWorkspaceWithMedia>[0];
type MediaStore = Parameters<typeof persistMediaAssets>[0];
type Asset = Parameters<typeof persistMediaAssets>[1][number];
const asset = (value: number): Asset => {
  const bytes = new Uint8Array([value]);
  return {
    reference: {
      id: Schema.decodeUnknownSync(MediaIdSchema)(createHash("sha256").update(bytes).digest("hex")),
      mimeType: "image/png",
      byteLength: bytes.byteLength,
    },
    bytes,
  };
};
const existing = asset(1);
const added = asset(2);
const failed = asset(3);
function workspace(assets: readonly Asset[] = [added]): Workspace {
  return {
    schemaVersion: 1,
    reviews: 0,
    areas: [
      {
        id: createAreaId("00000000-0000-4000-8000-000000000001"),
        title: "Media",
        color: "#123456",
        cards: [
          {
            id: createCardId("00000000-0000-4000-8000-000000000002"),
            front: "Question",
            back: "Answer",
            objective: "Media",
            media: assets.map((item) => item.reference),
            schedule: newSchedule(new Date("2026-10-04T00:00:00.000Z")),
          },
        ],
      },
    ],
  };
}

function stores(
  options: {
    readonly paired?: boolean;
    readonly failMediaId?: Asset["reference"]["id"];
    readonly failDeleteId?: Asset["reference"]["id"];
    readonly failList?: boolean;
    readonly failWorkspaceWrites?: number;
    readonly holdFirstPut?: {
      readonly entered: Deferred.Deferred<undefined>;
      readonly resume: Deferred.Deferred<undefined>;
    };
  } = {},
) {
  const lane = Effect.runSync(Effect.makeSemaphore(1));
  const assets = new Map([[existing.reference.id, existing]]);
  const trace: string[] = [];
  let snapshot: string | null = null;
  let remainingFailures = options.failWorkspaceWrites ?? 0;
  let puts = 0;
  let wrappedOperations = 0;
  let reads = 0;
  let pairedEntries = 0;
  const rawWorkspace: WorkspaceStore = {
    read: Effect.suspend(() => {
      reads += 1;
      return Effect.fail({ _tag: "LocalStoreFailure", operation: "read" } as const);
    }),
    write: (serialized) =>
      Effect.suspend(() => {
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          trace.push("workspace-failed");
          return Effect.fail({ _tag: "LocalStoreFailure", operation: "write" } as const);
        }
        trace.push("workspace-saved");
        snapshot = serialized;
        return Effect.void;
      }),
    clear: Effect.sync(() => {
      snapshot = null;
    }),
  };
  const rawMedia: MediaStore = {
    get: (id) => Effect.sync(() => assets.get(id) ?? null),
    list: Effect.suspend(() => {
      trace.push("list");
      return options.failList
        ? Effect.fail({ _tag: "MediaStoreFailure", operation: "list" } as const)
        : Effect.succeed([...assets.values()].map((item) => item.reference));
    }),
    put: (item) =>
      Effect.gen(function* () {
        puts += 1;
        trace.push(`put:${item.reference.id}`);
        if (item.reference.id === options.failMediaId)
          return yield* Effect.fail({ _tag: "MediaStoreFailure", operation: "write" } as const);
        assets.set(item.reference.id, item);
        if (puts === 1 && options.holdFirstPut) {
          yield* Deferred.succeed(options.holdFirstPut.entered, undefined);
          yield* Deferred.await(options.holdFirstPut.resume);
        }
      }),
    delete: (id) =>
      Effect.suspend(() => {
        trace.push(`delete:${id}`);
        if (id === options.failDeleteId)
          return Effect.fail({ _tag: "MediaStoreFailure", operation: "delete" } as const);
        assets.delete(id);
        return Effect.void;
      }),
  };
  function coordinated<A, E>(operation: Effect.Effect<A, E>) {
    return lane.withPermits(1)(
      Effect.suspend(() => {
        wrappedOperations += 1;
        return operation;
      }),
    );
  }
  const mediaStore: MediaStore = {
    ...rawMedia,
    put: (item) => coordinated(rawMedia.put(item)),
    delete: (id) => coordinated(rawMedia.delete(id)),
  };
  const workspaceStore: WorkspaceStore = {
    ...rawWorkspace,
    write: (serialized) => coordinated(rawWorkspace.write(serialized)),
    ...(options.paired
      ? {
          coordinateMediaCommit: (
            commit: Parameters<NonNullable<WorkspaceStore["coordinateMediaCommit"]>>[0],
          ) =>
            lane.withPermits(1)(
              Effect.gen(function* () {
                pairedEntries += 1;
                trace.push("paired-enter");
                yield* commit(rawWorkspace, rawMedia).pipe(
                  Effect.ensuring(
                    Effect.sync(() => {
                      trace.push("paired-exit");
                    }),
                  ),
                );
              }),
            ),
        }
      : {}),
  };
  return {
    workspaceStore,
    mediaStore,
    assets,
    trace,
    state: () => ({ snapshot, reads, pairedEntries, wrappedOperations }),
  };
}

await test("paired success writes media before its workspace without nesting per-operation locks or reading a baseline", async () => {
  const local = stores({ paired: true });
  const result = await Effect.runPromise(
    Effect.either(
      saveWorkspaceWithMedia(local.workspaceStore, local.mediaStore, workspace(), [added]),
    ),
  );
  assert.ok(Either.isRight(result));
  assert.deepEqual(local.trace, [
    "paired-enter",
    "list",
    `put:${added.reference.id}`,
    "workspace-saved",
    "paired-exit",
  ]);
  assert.equal(local.state().wrappedOperations, 0);
  assert.equal(local.state().reads, 0);
  assert.ok(local.state().snapshot);
  assert.ok(local.assets.has(added.reference.id));
});

await test("paired failure rolls back only initially absent assets, once per ID, retaining existing assets", async () => {
  for (const mediaFailure of [false, true]) {
    const local = stores({
      paired: true,
      failWorkspaceWrites: 1,
      ...(mediaFailure ? { failMediaId: failed.reference.id } : {}),
    });
    const result = await Effect.runPromise(
      Effect.either(
        saveWorkspaceWithMedia(
          local.workspaceStore,
          local.mediaStore,
          workspace([existing, added, failed]),
          [existing, added, added, failed],
        ),
      ),
    );
    assert.ok(Either.isLeft(result));
    assert.equal(result.left.reason, mediaFailure ? "media-write" : "workspace-write");
    assert.deepEqual([...local.assets.keys()], [existing.reference.id]);
    assert.equal(local.trace.filter((entry) => entry === `delete:${added.reference.id}`).length, 1);
    assert.ok(!local.trace.includes(`delete:${existing.reference.id}`));
    assert.equal(local.state().snapshot, null);
    assert.equal(local.state().wrappedOperations, 0);
    assert.equal(local.state().reads, 0);
  }
});

await test("unpaired media and workspace failures retain successful writes for another writer or retry", async () => {
  for (const mediaFailure of [false, true]) {
    const local = stores({
      failWorkspaceWrites: 1,
      ...(mediaFailure ? { failMediaId: failed.reference.id } : {}),
    });
    const result = await Effect.runPromise(
      Effect.either(
        saveWorkspaceWithMedia(local.workspaceStore, local.mediaStore, workspace([added, failed]), [
          added,
          failed,
        ]),
      ),
    );
    assert.ok(Either.isLeft(result));
    assert.equal(result.left.reason, mediaFailure ? "media-write" : "workspace-write");
    assert.ok(local.assets.has(existing.reference.id));
    assert.ok(local.assets.has(added.reference.id));
    assert.ok(local.trace.every((entry) => !entry.startsWith("delete:")));
  }
  const standalone = stores({ failMediaId: failed.reference.id });
  const result = await Effect.runPromise(
    Effect.either(persistMediaAssets(standalone.mediaStore, [added, failed])),
  );
  assert.ok(Either.isLeft(result));
  assert.ok(standalone.assets.has(added.reference.id));
});

await test("rollback failures are typed and remaining deletions are attempted before leaving the exclusive commit", async () => {
  const local = stores({ paired: true, failWorkspaceWrites: 1, failDeleteId: added.reference.id });
  const result = await Effect.runPromise(
    Effect.either(
      saveWorkspaceWithMedia(local.workspaceStore, local.mediaStore, workspace([added, failed]), [
        added,
        failed,
      ]),
    ),
  );
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, "media-rollback");
  assert.ok(local.assets.has(added.reference.id));
  assert.ok(!local.assets.has(failed.reference.id));
  assert.equal(local.trace.at(-1), "paired-exit");
});

await test("empty asset commits bypass media and paired coordination; failed listing mutates neither store", async () => {
  const empty = stores({ paired: true, failList: true });
  const result = await Effect.runPromise(
    Effect.either(
      saveWorkspaceWithMedia(empty.workspaceStore, empty.mediaStore, workspace([]), []),
    ),
  );
  assert.ok(Either.isRight(result));
  assert.deepEqual(empty.trace, ["workspace-saved"]);
  assert.equal(empty.state().pairedEntries, 0);
  assert.equal(empty.state().wrappedOperations, 1);
  const missing = stores({ paired: true, failList: true });
  const failure = await Effect.runPromise(
    Effect.either(
      saveWorkspaceWithMedia(missing.workspaceStore, missing.mediaStore, workspace(), [added]),
    ),
  );
  assert.ok(Either.isLeft(failure));
  assert.equal(failure.left.reason, "media-list");
  assert.equal(missing.state().snapshot, null);
  assert.deepEqual([...missing.assets.keys()], [existing.reference.id]);
});

await test("a queued paired commit cannot adopt media between another commit's listing and rollback", async () => {
  const entered = Effect.runSync(Deferred.make<undefined>());
  const resume = Effect.runSync(Deferred.make<undefined>());
  const local = stores({ paired: true, failWorkspaceWrites: 1, holdFirstPut: { entered, resume } });
  const first = Effect.runPromise(
    Effect.either(
      saveWorkspaceWithMedia(local.workspaceStore, local.mediaStore, workspace(), [added]),
    ),
  );
  await Effect.runPromise(Deferred.await(entered));
  const second = Effect.runPromise(
    Effect.either(
      saveWorkspaceWithMedia(local.workspaceStore, local.mediaStore, workspace(), [added]),
    ),
  );
  await Effect.runPromise(Effect.yieldNow());
  assert.equal(local.state().pairedEntries, 1);
  assert.ok(local.assets.has(added.reference.id));
  await Effect.runPromise(Deferred.succeed(resume, undefined));
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.ok(Either.isLeft(firstResult));
  assert.ok(Either.isRight(secondResult));
  assert.equal(local.state().pairedEntries, 2);
  assert.equal(local.state().wrappedOperations, 0);
  assert.equal(local.state().reads, 0);
  const persisted = await Effect.runPromise(parseWorkspaceJson(local.state().snapshot ?? ""));
  for (const card of persisted.areas.flatMap((area) => area.cards))
    for (const reference of card.media ?? []) assert.ok(local.assets.has(reference.id));
  const deletion = local.trace.indexOf(`delete:${added.reference.id}`);
  const lastPut = local.trace.lastIndexOf(`put:${added.reference.id}`);
  assert.ok(deletion > 0 && lastPut > deletion);
});
