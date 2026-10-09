import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Effect, Either, Schema } from "effect";
import { createAreaId, createAssessmentId, MediaIdSchema, type Workspace } from "@recall/domain";
import type { MediaStore, StoredMediaAsset, WorkspaceStore } from "../../local-store/src/index";
import {
  applyWorkspaceAuthoringCommand,
  cardVersionHistory,
  exportWorkspaceBackupPackage,
  findCardDuplicates,
  importWorkspaceBackupPackage,
  loadWorkspace,
  recordReview,
  saveWorkspace,
  saveWorkspaceWithMedia,
  searchWorkspace,
  toKnowledgeArea,
  workspaceAuthoringBaseline,
  workspaceDuplicateCandidates,
  type WorkspaceAuthoringCommand,
} from "@recall/application";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const areaId = createAreaId(id(1));
const cardId = createAssessmentId(id(2));
const now = new Date("2026-10-04T00:00:00.000Z");
const later = new Date("2026-10-05T00:00:00.000Z");
const content = {
  kind: "basic" as const,
  front: "What is a goroutine?",
  back: "A function executing concurrently with other goroutines.",
  objectiveIds: [],
  tags: ["concurrency"],
  media: [],
};
function success<A, E>(operation: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}
function stores() {
  let serialized: string | null = null;
  let failWrite = false;
  const assets = new Map<string, StoredMediaAsset>();
  const workspace: WorkspaceStore = {
    read: Effect.sync(() => serialized),
    write: (value) =>
      Effect.suspend(() => {
        if (failWrite)
          return Effect.fail({ _tag: "LocalStoreFailure", operation: "write" } as const);
        serialized = value;
        return Effect.void;
      }),
    clear: Effect.sync(() => {
      serialized = null;
    }),
    coordinateMediaCommit: (commit) => commit(workspace, media),
  };
  const media: MediaStore = {
    get: (key) => Effect.sync(() => assets.get(key) ?? null),
    put: (asset) =>
      Effect.sync(() => {
        assets.set(asset.reference.id, asset);
      }),
    delete: (key) =>
      Effect.sync(() => {
        assets.delete(key);
      }),
    list: Effect.sync(() => [...assets.values()].map((asset) => asset.reference)),
  };
  return {
    workspace,
    media,
    assets,
    fail: () => {
      failWrite = true;
    },
  };
}
function initial(): Workspace {
  return success(
    applyWorkspaceAuthoringCommand(
      { schemaVersion: 1, reviews: 0, areas: [] },
      {
        kind: "save-area",
        mode: "create",
        id: areaId,
        title: "Go programming",
        color: "#123456",
      },
      now,
    ),
  ).workspace;
}
function created(): Workspace {
  return success(
    applyWorkspaceAuthoringCommand(
      initial(),
      { kind: "create-card", areaId, cardId, content },
      now,
    ),
  ).workspace;
}
function reload(store: WorkspaceStore): Workspace {
  const loaded = success(loadWorkspace(store));
  assert.ok(loaded._tag === "Loaded");
  return loaded.workspace;
}
function edit(input: Workspace, back: string): Workspace {
  return success(
    applyWorkspaceAuthoringCommand(
      input,
      { kind: "update-card", areaId, cardId, content: { ...content, back } },
      later,
    ),
  ).workspace;
}
function reviewed(input: Workspace): Workspace {
  return success(
    recordReview({
      workspace: input,
      areaId,
      cardId,
      eventId: id(3),
      rating: "good",
      ratedAt: later.toISOString(),
    }),
  ).workspace;
}

await test("create, review, edit and restore survive storage reload while search follows live content", () => {
  const local = stores();
  const original = created();
  success(saveWorkspace(local.workspace, original));
  const studied = reviewed(reload(local.workspace));
  const edited = edit(studied, "A lightweight concurrent function managed by the Go runtime.");
  success(saveWorkspace(local.workspace, edited));
  const persisted = reload(local.workspace);
  assert.equal(searchWorkspace(persisted, [], "lightweight")[0]?.kind, "card");
  const version = cardVersionHistory(persisted, areaId, cardId)[0];
  assert.ok(version);
  const restored = success(
    applyWorkspaceAuthoringCommand(
      persisted,
      { kind: "restore-card", areaId, cardId, versionId: version.id },
      later,
    ),
  ).workspace;
  success(saveWorkspace(local.workspace, restored));
  const final = reload(local.workspace);
  assert.equal(final.areas[0]?.cards[0]?.back, content.back);
  assert.deepEqual(final.reviewEvents, studied.reviewEvents);
  assert.deepEqual(final.areas[0].cards[0].schedule, studied.areas[0]?.cards[0]?.schedule);
  assert.equal(searchWorkspace(final, [], "lightweight").length, 0);
  assert.equal(cardVersionHistory(final).length, 2);
  assert.equal(original.cardVersions, undefined);
});

await test("deleted cards disappear from search and duplicates but can be recovered with review evidence", () => {
  const local = stores();
  const studied = reviewed(created());
  const deleted = success(
    applyWorkspaceAuthoringCommand(studied, { kind: "delete-card", areaId, cardId }, later),
  ).workspace;
  success(saveWorkspace(local.workspace, deleted));
  const persisted = reload(local.workspace);
  assert.equal(searchWorkspace(persisted, [], "goroutine").length, 0);
  assert.equal(findCardDuplicates(content, workspaceDuplicateCandidates(persisted)).length, 0);
  const version = cardVersionHistory(persisted)[0];
  assert.ok(version);
  const restored = success(
    applyWorkspaceAuthoringCommand(
      persisted,
      { kind: "restore-card", areaId, cardId, versionId: version.id },
      later,
    ),
  ).workspace;
  assert.deepEqual(restored.reviewEvents, studied.reviewEvents);
  assert.equal(restored.areas[0]?.cards[0]?.id, cardId);
  assert.deepEqual(restored.areas[0].cards[0].schedule, studied.areas[0]?.cards[0]?.schedule);
  assert.equal(
    findCardDuplicates(content, workspaceDuplicateCandidates(restored))[0]?.kind,
    "exact",
  );
  assert.equal(restored.deletedCards?.length, 0);
});

await test("concurrent review remains compatible with edit baseline; a subsequent content edit rejects stale restore", () => {
  const first = edit(created(), "First revision");
  const version = cardVersionHistory(first)[0];
  assert.ok(version);
  const command: WorkspaceAuthoringCommand = {
    kind: "restore-card",
    areaId,
    cardId,
    versionId: version.id,
  };
  const baseline = workspaceAuthoringBaseline(first, command);
  const concurrentReview = reviewed(first);
  const accepted = success(
    applyWorkspaceAuthoringCommand(concurrentReview, command, later, baseline),
  ).workspace;
  assert.deepEqual(accepted.reviewEvents, concurrentReview.reviewEvents);
  const competing = edit(concurrentReview, "Competing revision");
  const rejected = Effect.runSync(
    Effect.either(applyWorkspaceAuthoringCommand(competing, command, later, baseline)),
  );
  assert.ok(Either.isLeft(rejected));
  assert.equal(rejected.left.reason, "stale-content");
  assert.equal(competing.areas[0]?.cards[0]?.back, "Competing revision");
});

await test("a connected deleted card is restored as a new identity and never rewrites old review ownership", () => {
  const studied = reviewed(created());
  const deleted = success(
    applyWorkspaceAuthoringCommand(
      { ...studied, syncOwnerId: id(9) },
      { kind: "delete-card", areaId, cardId },
      later,
    ),
  ).workspace;
  const version = cardVersionHistory(deleted)[0];
  assert.ok(version);
  const restored = success(
    applyWorkspaceAuthoringCommand(
      deleted,
      { kind: "restore-card", areaId, cardId, versionId: version.id },
      later,
    ),
  ).workspace;
  const copy = restored.areas[0]?.cards[0];
  assert.ok(copy);
  assert.notEqual(copy.id, cardId);
  assert.equal(copy.schedule.reps, 0);
  assert.deepEqual(restored.reviewEvents, studied.reviewEvents);
  assert.equal(restored.reviewEvents?.[0]?.cardId, cardId);
  assert.deepEqual(restored.deletedCards, deleted.deletedCards);
});

await test("private backup retains attachments used only by historical versions after live content removes them", () => {
  const local = stores();
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const asset: StoredMediaAsset = {
    bytes,
    reference: {
      id: Schema.decodeUnknownSync(MediaIdSchema)(createHash("sha256").update(bytes).digest("hex")),
      mimeType: "image/png",
      byteLength: bytes.length,
    },
  };
  const attached = success(
    applyWorkspaceAuthoringCommand(
      initial(),
      { kind: "create-card", areaId, cardId, content: { ...content, media: [asset.reference] } },
      now,
    ),
  ).workspace;
  success(saveWorkspaceWithMedia(local.workspace, local.media, attached, [asset]));
  const edited = edit(reviewed(reload(local.workspace)), "Revised answer without attachment");
  success(saveWorkspace(local.workspace, edited));
  const archive = success(
    exportWorkspaceBackupPackage(reload(local.workspace), later.toISOString(), local.media),
  );
  const backup = success(importWorkspaceBackupPackage(archive));
  assert.deepEqual(backup.media, [asset]);
  assert.equal(backup.workspace.areas[0]?.cards[0]?.media?.length, 0);
  const version = cardVersionHistory(backup.workspace)[0];
  assert.ok(version);
  assert.deepEqual(version.card.media, [asset.reference]);
  const recovered = success(
    applyWorkspaceAuthoringCommand(
      backup.workspace,
      { kind: "restore-card", areaId, cardId, versionId: version.id },
      later,
    ),
  ).workspace;
  assert.deepEqual(recovered.areas[0]?.cards[0]?.media, [asset.reference]);
  assert.deepEqual(recovered.reviewEvents, edited.reviewEvents);
  local.assets.clear();
  const unavailable = Effect.runSync(
    Effect.either(exportWorkspaceBackupPackage(edited, later.toISOString(), local.media)),
  );
  assert.ok(Either.isLeft(unavailable));
  assert.equal(unavailable.left.reason, "media-unavailable");
});

await test("failed coordinated media commit rolls back new assets and preserves persisted authored history", () => {
  const local = stores();
  const prior = edit(reviewed(created()), "Persisted revision");
  success(saveWorkspace(local.workspace, prior));
  const persistedPrior = reload(local.workspace);
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const asset: StoredMediaAsset = {
    bytes,
    reference: {
      id: Schema.decodeUnknownSync(MediaIdSchema)(createHash("sha256").update(bytes).digest("hex")),
      mimeType: "image/png",
      byteLength: bytes.length,
    },
  };
  const proposed = success(
    applyWorkspaceAuthoringCommand(
      prior,
      { kind: "update-card", areaId, cardId, content: { ...content, media: [asset.reference] } },
      later,
    ),
  ).workspace;
  local.fail();
  const failed = Effect.runSync(
    Effect.either(saveWorkspaceWithMedia(local.workspace, local.media, proposed, [asset])),
  );
  assert.ok(Either.isLeft(failed));
  assert.equal(failed.left.reason, "workspace-write");
  assert.equal(local.assets.size, 0);
  assert.deepEqual(reload(local.workspace).cardVersions, persistedPrior.cardVersions);
  assert.deepEqual(reload(local.workspace).reviewEvents, persistedPrior.reviewEvents);
  assert.equal(searchWorkspace(reload(local.workspace), [], "Persisted revision").length, 1);
});

await test("AI split replacement preserves reviewed originals privately while searchable children start fresh", () => {
  const local = stores();
  const studied = reviewed(created());
  const replaced = success(
    applyWorkspaceAuthoringCommand(
      studied,
      {
        kind: "replace-card",
        areaId,
        cardId,
        cards: [
          {
            cardId: createAssessmentId(id(20)),
            content: { ...content, front: "What starts a goroutine?", back: "A go statement." },
          },
          {
            cardId: createAssessmentId(id(21)),
            content: {
              ...content,
              front: "How is a goroutine scheduled?",
              back: "By the Go runtime.",
            },
          },
        ],
      },
      later,
    ),
  ).workspace;
  success(saveWorkspace(local.workspace, replaced));
  const persisted = reload(local.workspace);
  assert.equal(persisted.areas[0]?.cards.length, 2);
  assert.ok(persisted.areas[0].cards.every((card) => card.schedule.reps === 0));
  assert.deepEqual(persisted.reviewEvents, studied.reviewEvents);
  assert.equal(cardVersionHistory(persisted, areaId, cardId)[0]?.card.back, content.back);
  assert.equal(searchWorkspace(persisted, [], "goroutine", { kinds: ["card"] }).length, 2);
  assert.equal(findCardDuplicates(content, workspaceDuplicateCandidates(persisted)).length, 0);
  const liveArea = persisted.areas[0];
  assert.ok(liveArea);
  const shared = success(toKnowledgeArea(liveArea));
  assert.equal(shared.cards.length, 2);
  const sharedText = JSON.stringify(shared);
  assert.ok(!sharedText.includes(content.back));
  assert.ok(!sharedText.includes("cardVersions"));
  assert.ok(!sharedText.includes("reviewEvents"));
});

await test("invalid second child rejects a split without deleting its reviewed original or appending versions", () => {
  const studied = reviewed(created());
  const before = JSON.stringify(studied);
  const rejected = Effect.runSync(
    Effect.either(
      applyWorkspaceAuthoringCommand(
        studied,
        {
          kind: "replace-card",
          areaId,
          cardId,
          cards: [
            { cardId: createAssessmentId(id(20)), content },
            { cardId: createAssessmentId(id(21)), content: { ...content, back: " " } },
          ],
        },
        later,
      ),
    ),
  );
  assert.ok(Either.isLeft(rejected));
  assert.equal(JSON.stringify(studied), before);
  assert.equal(studied.areas[0]?.cards.length, 1);
  assert.equal(studied.cardVersions, undefined);
  assert.equal(searchWorkspace(studied, [], "goroutine", { kinds: ["card"] }).length, 1);
});
