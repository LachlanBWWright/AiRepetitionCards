import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { createAssessmentId } from "@recall/domain";
import { WorkspaceCheckpointsSchema } from "@recall/local-store";
import {
  captureDesktopCheckpoint,
  readCheckpointArchive,
} from "../../../../apps/desktop/src/main/ipc/workspace-checkpoint-storage";
import { writeDesktopWorkspaceSnapshot } from "../../../../apps/desktop/src/main/ipc/workspace-snapshot-chunks";
import { workspace, uuid } from "./workspace-sync-fixtures.js";

function setup(database: DatabaseSync) {
  database.exec(`CREATE TABLE local_workspace(id INTEGER PRIMARY KEY,serialized_workspace TEXT,updated_at TEXT);
    CREATE TABLE local_workspace_chunks(part INTEGER PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE workspace_checkpoints(id INTEGER PRIMARY KEY,entries TEXT NOT NULL);
    CREATE TABLE workspace_checkpoint_chunks(part INTEGER PRIMARY KEY,payload TEXT NOT NULL);`);
}
void test("SQLite checkpoint chunks survive reopening and protect previous large Unicode snapshots", () => {
  const directory = mkdtempSync(join(tmpdir(), "recall-checkpoints-"));
  const file = join(directory, "recovery.db");
  let database = new DatabaseSync(file);
  try {
    setup(database);
    const original = workspace([]),
      area = original.areas[0],
      card = area?.cards[0];
    assert.ok(area && card);
    const large = {
      ...original,
      areas: [
        {
          ...area,
          cards: Array.from({ length: 300 }, (_, index) => ({
            ...card,
            id: createAssessmentId(uuid(index + 100)),
            front: "🙂".repeat(2000),
          })),
        },
      ],
    };
    const serialized = JSON.stringify(large);
    assert.ok(new TextEncoder().encode(serialized).byteLength > 2_000_000);
    assert.equal(writeDesktopWorkspaceSnapshot(database, serialized), true);
    assert.equal(
      captureDesktopCheckpoint(
        database,
        JSON.stringify(original),
        new Date("2026-10-22T12:00:00Z"),
      ),
      true,
    );
    database.close();
    database = new DatabaseSync(file);
    const entries = Schema.decodeUnknownSync(WorkspaceCheckpointsSchema)(
      readCheckpointArchive(database),
    );
    assert.equal(entries[0]?.serializedWorkspace, serialized);
    const count = database.prepare("SELECT count(*) count FROM workspace_checkpoint_chunks").get();
    assert.ok(typeof count?.count === "number" && count.count > 1);
    database.prepare("DELETE FROM workspace_checkpoint_chunks WHERE part=0").run();
    assert.equal(readCheckpointArchive(database), null);
    assert.equal(
      captureDesktopCheckpoint(database, serialized, new Date("2026-10-22T13:00:00Z")),
      false,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
void test("SQLite checkpoint write failures roll back the archive instead of destroying recovery", () => {
  const database = new DatabaseSync(":memory:");
  try {
    setup(database);
    const serialized = JSON.stringify(workspace([]));
    assert.equal(
      captureDesktopCheckpoint(database, serialized, new Date("2026-10-22T12:00:00Z")),
      true,
    );
    const original = readCheckpointArchive(database);
    database.exec(
      "CREATE TRIGGER reject_checkpoint BEFORE INSERT ON workspace_checkpoint_chunks BEGIN SELECT RAISE(ABORT,'disk unavailable'); END;",
    );
    assert.equal(
      captureDesktopCheckpoint(database, serialized, new Date("2026-10-22T13:00:00Z")),
      false,
    );
    assert.deepEqual(readCheckpointArchive(database), original);
  } finally {
    database.close();
  }
});
