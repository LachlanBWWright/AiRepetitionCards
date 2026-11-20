import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Schema } from "effect";
import { WorkspaceContentPushRequestSchema } from "@recall/contracts";
import { WorkspaceSchema, createDeviceId, MediaIdSchema, type Workspace } from "@recall/domain";
import { createHash } from "node:crypto";
import type { MediaStore, StoredMediaAsset } from "@recall/local-store";
import {
  syncWorkspace,
  applyWorkspaceSyncChanges,
  applyWorkspaceContentConflict,
  recordReview,
  exportWorkspaceBackupPackage,
  importWorkspaceBackupPackage,
} from "@recall/application";
import {
  readDesktopWorkspaceSnapshot,
  writeDesktopWorkspaceSnapshot,
} from "../../../../apps/desktop/src/main/ipc/workspace-snapshot-chunks";
import { server, workspace, uuid, time } from "./workspace-sync-fixtures";

function openDevice(file: string) {
  const database = new DatabaseSync(file);
  database.exec(
    "CREATE TABLE IF NOT EXISTS local_workspace(id INTEGER PRIMARY KEY, serialized_workspace TEXT, updated_at TEXT); CREATE TABLE IF NOT EXISTS local_workspace_chunks(part INTEGER PRIMARY KEY,payload TEXT NOT NULL)",
  );
  return {
    close: () => {
      database.close();
    },
    save: (value: Workspace) => {
      assert.equal(writeDesktopWorkspaceSnapshot(database, JSON.stringify(value)), true);
    },
    load: () => {
      const raw = readDesktopWorkspaceSnapshot(database);
      assert.equal(typeof raw, "string");
      return Schema.decodeUnknownSync(Schema.parseJson(WorkspaceSchema))(raw);
    },
  };
}
function mediaStore(assets: Map<string, StoredMediaAsset>): MediaStore {
  return {
    get: (id) => Effect.succeed(assets.get(id) ?? null),
    put: (asset) =>
      Effect.sync(() => {
        assets.set(asset.reference.id, asset);
      }),
    delete: (id) =>
      Effect.sync(() => {
        assets.delete(id);
      }),
    list: Effect.sync(() => [...assets.values()].map((asset) => asset.reference)),
  };
}

function contentConflict(
  remote: ReturnType<typeof server>,
  request: import("@recall/application").WorkspaceSyncRequest,
) {
  if (request.path !== "/api/v1/workspace" || request.method !== "POST") return null;
  const body = Schema.decodeUnknownSync(WorkspaceContentPushRequestSchema)(request.body);
  const stale = body.areas.some((entry) => {
    const previous = remote.documents.get(entry.document.id);
    return previous && previous.contentHash !== entry.baseContentHash;
  });
  return stale ? { status: 409, body: { error: "content-conflict" } } : null;
}

await test("daily-use acceptance: two durable devices review offline, retry lost responses, resolve conflicts and restore a media backup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recall-daily-acceptance-"));
  const aPath = join(directory, "desktop.db"),
    bPath = join(directory, "second-device.db");
  let a = openDevice(aPath),
    b = openDevice(bPath);
  const remote = server();
  const assetsA = new Map<string, StoredMediaAsset>(),
    assetsB = new Map<string, StoredMediaAsset>(),
    remoteMedia = new Map<string, StoredMediaAsset>();
  let authorized = true;
  try {
    a.save(workspace([]));
    b.save({ schemaVersion: 1, reviews: 0, areas: [], syncDeviceId: createDeviceId(uuid(801)) });
    const uploadAsset = (asset: StoredMediaAsset) =>
      Effect.sync(() => {
        remoteMedia.set(asset.reference.id, asset);
      });
    const checkpoint =
      (input: ReturnType<typeof remote.input>, device: ReturnType<typeof openDevice>) =>
      (bound: Workspace) =>
        input.checkpoint(bound).pipe(
          Effect.tap((saved) =>
            Effect.sync(() => {
              device.save(saved);
            }),
          ),
        );
    const synchronize = (
      device: ReturnType<typeof openDevice>,
      assets: Map<string, StoredMediaAsset>,
    ) => {
      const current = device.load();
      const input = remote.input(current);
      const result = Effect.runSync(
        Effect.either(
          syncWorkspace({
            ...input,
            transport: (request) => {
              if (!authorized)
                return Effect.succeed({ status: 401, body: { error: "unauthorized" } });
              const conflict = contentConflict(remote, request);
              if (conflict) return Effect.succeed(conflict);
              return input.transport(request);
            },
            checkpoint: checkpoint(input, device),
            mediaStore: mediaStore(assets),
            mediaGatewayForOwner: () => ({
              upload: uploadAsset,
              read: (reference) => Effect.succeed(remoteMedia.get(reference.id) ?? null),
            }),
          }),
        ),
      );
      if (Either.isRight(result) && result.right._tag !== "ContentConflict")
        device.save(
          Effect.runSync(applyWorkspaceSyncChanges(device.load(), result.right, () => uuid(899))),
        );
      return result;
    };
    assert.ok(Either.isRight(synchronize(a, assetsA)));
    assert.ok(Either.isRight(synchronize(b, assetsB)));
    const baseline = a.load(),
      source = baseline.areas[0],
      target = source?.cards[0];
    assert.ok(source && target);
    const answer = (device: ReturnType<typeof openDevice>, id: number) => {
      const current = device.load();
      device.save(
        Effect.runSync(
          recordReview({
            workspace: current,
            areaId: source.id,
            cardId: target.id,
            rating: "good",
            eventId: uuid(id),
            ratedAt: time,
          }),
        ).workspace,
      );
    };
    answer(a, 810);
    answer(b, 811);
    a.close();
    a = openDevice(aPath);
    b.close();
    b = openDevice(bPath);
    assert.equal(a.load().pendingReviewEventIds?.length, 1);
    assert.equal(b.load().pendingReviewEventIds?.length, 1);
    authorized = false;
    assert.ok(Either.isLeft(synchronize(a, assetsA)));
    assert.equal(a.load().reviewEvents?.length, 1);
    assert.equal(a.load().pendingReviewEventIds?.length, 1);
    authorized = true;
    remote.loseReviewResponse();
    assert.ok(Either.isLeft(synchronize(a, assetsA)));
    assert.equal(remote.reviews.size, 1);
    assert.ok(Either.isRight(synchronize(a, assetsA)));
    assert.equal(remote.reviews.size, 1);
    assert.ok(Either.isRight(synchronize(b, assetsB)));
    assert.ok(Either.isRight(synchronize(a, assetsA)));
    assert.equal(a.load().reviewEvents?.length, 2);
    assert.equal(b.load().reviewEvents?.length, 2);
    const change = (device: ReturnType<typeof openDevice>, title: string) => {
      const value = device.load();
      device.save({ ...value, areas: value.areas.map((area) => ({ ...area, title })) });
    };
    change(a, "Desktop edit");
    change(b, "Offline phone edit");
    assert.ok(Either.isRight(synchronize(a, assetsA)));
    const conflict = synchronize(b, assetsB);
    assert.ok(Either.isRight(conflict) && conflict.right._tag === "ContentConflict");
    assert.equal(b.load().areas[0]?.title, "Offline phone edit");
    assert.equal(b.load().reviewEvents?.length, 2);
    const resolved = Effect.runSync(applyWorkspaceContentConflict(b.load(), conflict.right));
    b.save(resolved);
    assert.equal(b.load().areas[0]?.title, "Desktop edit");
    assert.equal(b.load().reviewEvents?.length, 2);
    const bytes = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const reference = {
      id: Schema.decodeUnknownSync(MediaIdSchema)(createHash("sha256").update(bytes).digest("hex")),
      mimeType: "image/png" as const,
      byteLength: bytes.length,
    };
    assetsA.set(reference.id, { reference, bytes });
    const current = a.load();
    a.save({
      ...current,
      areas: current.areas.map((area) => ({
        ...area,
        cards: area.cards.map((card) => ({ ...card, media: [reference] })),
      })),
    });
    assert.ok(Either.isRight(synchronize(a, assetsA)));
    assert.ok(remoteMedia.has(reference.id));
    const archive = await Effect.runPromise(
      exportWorkspaceBackupPackage(a.load(), time, mediaStore(assetsA)),
    );
    const restored = Effect.runSync(importWorkspaceBackupPackage(archive));
    assert.equal(restored.workspace.reviewEvents?.length, 2);
    assert.deepEqual(restored.media[0]?.bytes, bytes);
    a.save(restored.workspace);
    a.close();
    a = openDevice(aPath);
    assert.deepEqual(a.load().reviewEvents, restored.workspace.reviewEvents);
    assert.equal(a.load().areas[0]?.cards[0]?.media?.[0]?.id, reference.id);
  } finally {
    a.close();
    b.close();
    await rm(directory, { recursive: true, force: true });
  }
});
