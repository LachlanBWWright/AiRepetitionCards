import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  joinWorkspaceChunks,
  splitWorkspacePayload,
  workspaceChunkCount,
  workspaceChunkManifest,
} from "@recall/local-store";
import {
  readDesktopWorkspaceSnapshot,
  writeDesktopWorkspaceSnapshot,
} from "../../../../apps/desktop/src/main/ipc/workspace-snapshot-chunks";
await test("workspace payload chunks preserve Unicode across small SQLite rows", () => {
  const value = `{"text":"${"a".repeat(65_535)}😀${"漢字😀".repeat(500_000)}"}`;
  const chunks = splitWorkspacePayload(value);
  assert.ok(chunks.length > 10);
  assert.ok(chunks.every((chunk) => new TextEncoder().encode(chunk).byteLength <= 262_144));
  assert.equal(
    joinWorkspaceChunks(
      chunks.map((payload, part) => ({ part, payload })),
      chunks.length,
    ),
    value,
  );
  assert.equal(workspaceChunkCount(workspaceChunkManifest(chunks.length)), chunks.length);
  assert.equal(joinWorkspaceChunks([{ part: 1, payload: "lost" }], 1), undefined);
});
await test("desktop SQLite persists snapshots above five megabytes and detects missing chunks", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(
    "CREATE TABLE local_workspace(id INTEGER PRIMARY KEY,serialized_workspace TEXT,updated_at TEXT); CREATE TABLE local_workspace_chunks(part INTEGER PRIMARY KEY,payload TEXT)",
  );
  const serialized = JSON.stringify({
    cards: Array.from({ length: 6_000 }, (_, index) => ({
      id: String(index),
      front: "Question ".repeat(100),
      back: "Answer ".repeat(100),
    })),
  });
  assert.ok(new TextEncoder().encode(serialized).byteLength > 5_000_000);
  assert.equal(writeDesktopWorkspaceSnapshot(database, serialized), true);
  assert.equal(readDesktopWorkspaceSnapshot(database), serialized);
  database.prepare("DELETE FROM local_workspace_chunks WHERE part=2").run();
  assert.equal(readDesktopWorkspaceSnapshot(database), undefined);
  database.close();
});
await test("desktop SQLite reads legacy snapshots before the first chunked write", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(
    "CREATE TABLE local_workspace(id INTEGER PRIMARY KEY,serialized_workspace TEXT,updated_at TEXT); CREATE TABLE local_workspace_chunks(part INTEGER PRIMARY KEY,payload TEXT)",
  );
  database.prepare("INSERT INTO local_workspace VALUES(1,?,?)").run("legacy", "now");
  assert.equal(readDesktopWorkspaceSnapshot(database), "legacy");
  database.close();
});

await test("a failed desktop chunk write rolls back to the complete previous snapshot", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(
    "CREATE TABLE local_workspace(id INTEGER PRIMARY KEY,serialized_workspace TEXT,updated_at TEXT); CREATE TABLE local_workspace_chunks(part INTEGER PRIMARY KEY,payload TEXT)",
  );
  const previous = "a".repeat(100_000);
  assert.equal(writeDesktopWorkspaceSnapshot(database, previous), true);
  database.exec(
    "CREATE TRIGGER fail_second_chunk BEFORE INSERT ON local_workspace_chunks WHEN new.part = 1 BEGIN SELECT RAISE(ABORT, 'disk write failed'); END",
  );
  assert.equal(writeDesktopWorkspaceSnapshot(database, "b".repeat(200_000)), false);
  assert.equal(readDesktopWorkspaceSnapshot(database), previous);
  database.close();
});

await test("snapshot commits update only changed chunks and remove stale tail rows", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE local_workspace(id INTEGER PRIMARY KEY,serialized_workspace TEXT,updated_at TEXT);
    CREATE TABLE local_workspace_chunks(part INTEGER PRIMARY KEY,payload TEXT);
    CREATE TABLE chunk_writes(part INTEGER);
    CREATE TRIGGER count_update AFTER UPDATE ON local_workspace_chunks BEGIN INSERT INTO chunk_writes VALUES(new.part); END;
  `);
  const previous = "a".repeat(200_000);
  assert.equal(writeDesktopWorkspaceSnapshot(database, previous), true);
  assert.equal(writeDesktopWorkspaceSnapshot(database, `${previous.slice(0, -1)}b`), true);
  assert.deepEqual(
    database
      .prepare("SELECT part FROM chunk_writes")
      .all()
      .map((row) => row.part),
    [3],
  );
  database.exec("DELETE FROM chunk_writes");
  assert.equal(writeDesktopWorkspaceSnapshot(database, previous.slice(0, 100_000)), true);
  assert.equal(readDesktopWorkspaceSnapshot(database), previous.slice(0, 100_000));
  assert.deepEqual(
    database
      .prepare("SELECT part FROM chunk_writes")
      .all()
      .map((row) => row.part),
    [1],
  );
  database.close();
});
