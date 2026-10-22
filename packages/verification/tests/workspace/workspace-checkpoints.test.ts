import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Schema } from "effect";
import {
  WorkspaceSchema,
  MediaReferenceSchema,
  createAssessmentId,
  type MediaReference,
  type Workspace,
} from "@recall/domain";
import {
  withWorkspaceCheckpoints,
  retainedWorkspaceCheckpoints,
  type WorkspaceCheckpoint,
  type WorkspaceCheckpointStore,
  type WorkspaceStore,
  type MediaStore,
} from "@recall/local-store";
import {
  restoreWorkspaceCheckpoint,
  repairCollectionReferences,
  purgeMediaTrash,
  applyMediaTrashPurge,
  applyWorkspaceAuthoringCommand,
  workspaceAuthoringBaseline,
} from "@recall/application";
import { workspace, review, uuid, owner } from "./workspace-sync-fixtures.js";

function archive() {
  let entries: readonly WorkspaceCheckpoint[] = [];
  const store: WorkspaceCheckpointStore = {
    durable: true,
    read: Effect.sync(() => entries),
    write: (next) =>
      Effect.sync(() => {
        entries = next;
      }),
  };
  return store;
}
function memory(initial: Workspace): WorkspaceStore {
  let serialized: string | null = JSON.stringify(initial);
  return {
    read: Effect.sync(() => serialized),
    write: (next) =>
      Effect.sync(() => {
        serialized = next;
      }),
    clear: Effect.sync(() => {
      serialized = null;
    }),
  };
}
void test("automatic checkpoints capture previous metadata, throttle and erase with local data", () => {
  const original = workspace([]);
  const checkpoints = archive();
  let now = new Date("2026-10-01T10:00:00Z");
  const store = withWorkspaceCheckpoints(memory(original), checkpoints, () => now);
  Effect.runSync(store.write(JSON.stringify({ ...original, reviews: 1 })));
  assert.equal(Effect.runSync(checkpoints.read).length, 1);
  assert.deepEqual(
    JSON.parse(Effect.runSync(checkpoints.read)[0]?.serializedWorkspace ?? "{}"),
    original,
  );
  Effect.runSync(store.write(JSON.stringify({ ...original, reviews: 2 })));
  assert.equal(Effect.runSync(checkpoints.read).length, 1);
  now = new Date("2026-10-01T10:30:00Z");
  Effect.runSync(store.write(JSON.stringify(original)));
  assert.equal(Effect.runSync(checkpoints.read).length, 2);
  Effect.runSync(store.clear);
  assert.deepEqual(Effect.runSync(checkpoints.read), []);
  assert.equal(Effect.runSync(store.read), null);
});
void test("retention bounds dense writes while retaining daily and weekly recovery points", () => {
  const entries = Array.from({ length: 2000 }, (_, index) => ({
    createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1800000).toISOString(),
    serializedWorkspace: "{}",
  }));
  const retained = retainedWorkspaceCheckpoints(entries);
  assert.ok(retained.length <= 23);
  assert.deepEqual(retained.slice(0, 12), [...entries].reverse().slice(0, 12));
  assert.ok(
    new Set(retained.map((entry) => Math.floor(Date.parse(entry.createdAt) / 604800000))).size >= 4,
  );
});
void test("restore rebuilds schedules without rewinding reviews or deleting newer cards", () => {
  const older = workspace([]);
  const first = older.areas[0];
  const card = first?.cards[0];
  assert.ok(first && card);
  const current = workspace([review()]);
  const newer: Workspace = {
    ...current,
    areas: [
      {
        ...first,
        cards: [
          { ...card, front: "Edited" },
          { ...card, id: createAssessmentId(uuid(90)), front: "New card" },
        ],
      },
    ],
  };
  const restored = Effect.runSync(restoreWorkspaceCheckpoint(newer, JSON.stringify(older)));
  assert.equal(restored.areas[0]?.cards[0]?.front, card.front);
  assert.equal(restored.areas[0].cards.length, 2);
  assert.deepEqual(restored.reviewEvents, current.reviewEvents);
  assert.equal(restored.areas[0].cards[0].schedule.reps, 1);
  assert.equal(Schema.is(WorkspaceSchema)(restored), true);
  assert.equal(newer.areas[0]?.cards[0]?.front, "Edited");
});
void test("restore rejects stale baseline and malformed checkpoints", () => {
  const original = workspace([]);
  const command = {
    kind: "restore-workspace-checkpoint" as const,
    serializedWorkspace: JSON.stringify(original),
  };
  const baseline = workspaceAuthoringBaseline(original, command);
  const stale = Effect.runSync(
    Effect.either(applyWorkspaceAuthoringCommand(workspace(), command, new Date(), baseline)),
  );
  assert.equal(stale._tag, "Left");
  assert.equal(
    Effect.runSync(Effect.either(restoreWorkspaceCheckpoint(original, "bad-json")))._tag,
    "Left",
  );
});
void test("safe repair removes dangling objective links without changing review history", () => {
  const original = workspace();
  const area = original.areas[0];
  assert.ok(area);
  const damaged = { ...original, areas: [{ ...area, objectives: [] }] };
  const fixed = Effect.runSync(repairCollectionReferences(damaged));
  assert.deepEqual(fixed.areas[0]?.cards[0]?.objectiveIds, []);
  assert.deepEqual(fixed.reviewEvents, original.reviewEvents);
});
void test("permanent trash cleanup protects latest content, drafts and automatic checkpoints", () => {
  const reference = (digit: string): MediaReference =>
    Schema.decodeUnknownSync(MediaReferenceSchema)({
      id: digit.repeat(64),
      mimeType: "image/png",
      byteLength: 8,
    });
  const active = reference("a"),
    draft = reference("b"),
    checkpoint = reference("c"),
    unused = reference("d");
  const original = workspace([]),
    area = original.areas[0],
    card = area?.cards[0];
  assert.ok(area && card);
  const current = {
    ...original,
    areas: [{ ...area, cards: [{ ...card, media: [active] }] }],
    mediaTrash: [active, draft, checkpoint, unused].map((entry) => ({
      reference: entry,
      trashedAt: "2026-01-01T00:00:00Z",
    })),
  };
  const checkpoints = archive();
  Effect.runSync(
    checkpoints.write([
      {
        createdAt: "2026-01-01T00:00:00Z",
        serializedWorkspace: JSON.stringify({
          ...original,
          areas: [{ ...area, cards: [{ ...card, media: [checkpoint] }] }],
        }),
      },
    ]),
  );
  const deleted: string[] = [];
  const media: MediaStore = {
    list: Effect.succeed([]),
    get: () => Effect.succeed(null),
    put: () => Effect.void,
    delete: (id) =>
      Effect.sync(() => {
        deleted.push(id);
      }),
  };
  const raw = { ...memory(current), checkpoints };
  const store: WorkspaceStore = { ...raw, coordinateMediaCommit: (commit) => commit(raw, media) };
  const result = Effect.runSync(purgeMediaTrash(store, () => [draft]));
  assert.deepEqual(deleted, [unused.id]);
  assert.equal(result.removed, 1);
  assert.equal(result.workspace.mediaTrash?.length, 3);
  const concurrent = {
    ...current,
    reviews: 9,
    mediaTrash: [
      ...current.mediaTrash,
      { reference: { ...unused, id: active.id }, trashedAt: "2026-10-23T00:00:00Z" },
    ],
  };
  const applied = applyMediaTrashPurge(concurrent, result);
  assert.equal(applied.reviews, 9);
  assert.equal(applied.mediaTrash?.length, 4);
  assert.equal(Effect.runSync(Effect.either(purgeMediaTrash(raw, () => [])))._tag, "Left");
});

void test("reopening a checkpoint adapter preserves rotation and does not overwrite the newest point", () => {
  const checkpoints = archive();
  const raw = memory(workspace([]));
  const first = withWorkspaceCheckpoints(raw, checkpoints, () => new Date("2026-10-01T10:00:00Z"));
  Effect.runSync(first.write(JSON.stringify(workspace([]))));
  const saved = Effect.runSync(checkpoints.read);
  const reopened = withWorkspaceCheckpoints(
    raw,
    checkpoints,
    () => new Date("2026-10-01T10:10:00Z"),
  );
  Effect.runSync(reopened.write(JSON.stringify(workspace())));
  assert.deepEqual(Effect.runSync(checkpoints.read), saved);
});
void test("restoring synced data preserves ownership, cursor and pending reviews; other account checkpoints fail", () => {
  const previous = { ...workspace([]), syncOwnerId: owner, syncCursor: "1" };
  const current = { ...workspace(), syncOwnerId: owner, syncCursor: "8" };
  const restored = Effect.runSync(restoreWorkspaceCheckpoint(current, JSON.stringify(previous)));
  assert.equal(restored.syncOwnerId, current.syncOwnerId);
  assert.equal(restored.syncCursor, current.syncCursor);
  assert.deepEqual(restored.pendingReviewEventIds, current.pendingReviewEventIds);
  assert.deepEqual(restored.reviewEvents, current.reviewEvents);
  const denied = Effect.runSync(
    Effect.either(restoreWorkspaceCheckpoint(workspace(), JSON.stringify(previous))),
  );
  assert.equal(denied._tag, "Left");
  assert.match(denied.left.message, /different account/);
});
