import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Deferred, Effect } from "effect";
import {
  readNativeWorkspaceSnapshot,
  writeNativeWorkspaceSnapshot,
  type NativeSnapshotDatabase,
  type NativeSnapshotTransaction,
} from "../../../../apps/mobile/src/storage/workspace/sqlite-snapshot-chunks";

function adapter(sqlite: DatabaseSync, afterManifest: () => Promise<void>): NativeSnapshotDatabase {
  const transaction: NativeSnapshotTransaction = {
    getFirstAsync: async (source) => {
      const row = sqlite.prepare(source).get();
      await afterManifest();
      if (!row) return null;
      assert.equal(typeof row.serialized_workspace, "string");
      if (typeof row.serialized_workspace !== "string") return null;
      return { serialized_workspace: row.serialized_workspace };
    },
    getAllAsync: (source) =>
      Promise.resolve(
        sqlite
          .prepare(source)
          .all()
          .flatMap((row) =>
            typeof row.part === "number" && typeof row.payload === "string"
              ? [{ part: row.part, payload: row.payload }]
              : [],
          ),
      ),
    runAsync: (source, ...parameters) => Promise.resolve(sqlite.prepare(source).run(...parameters)),
  };
  return {
    withExclusiveTransactionAsync: async (work) => {
      // Expo opens a dedicated connection and uses BEGIN, not BEGIN IMMEDIATE.
      sqlite.exec("BEGIN");
      const result = await Effect.runPromise(
        Effect.either(
          Effect.tryPromise({
            try: () => work(transaction),
            catch: () => ({ _tag: "FixtureTransactionFailure" }) as const,
          }),
        ),
      );
      sqlite.exec(result._tag === "Right" ? "COMMIT" : "ROLLBACK");
      assert.equal(result._tag, "Right");
    },
  };
}

await test(
  "native manifest and chunk reads retain one WAL snapshot while another connection commits a save",
  { timeout: 10_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "recall-native-snapshot-"));
    const file = join(directory, "workspace.sqlite");
    const reader = new DatabaseSync(file);
    reader.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE workspace_snapshot(id INTEGER PRIMARY KEY,serialized_workspace TEXT,updated_at TEXT); CREATE TABLE workspace_snapshot_chunks(part INTEGER PRIMARY KEY,payload TEXT)",
    );
    const writer = new DatabaseSync(file);
    const manifestRead = Effect.runSync(Deferred.make<undefined>());
    const continueRead = Effect.runSync(Deferred.make<undefined>());
    let pause = false;
    const reading = adapter(reader, async () => {
      if (!pause) return;
      await Effect.runPromise(Deferred.succeed(manifestRead, undefined));
      await Effect.runPromise(Deferred.await(continueRead));
    });
    const writing = adapter(writer, () => Promise.resolve());
    try {
      const previous = "old reviews".repeat(14_000);
      const next = "new reviews".repeat(30_000);
      await writeNativeWorkspaceSnapshot(writing, previous);
      pause = true;
      const read = readNativeWorkspaceSnapshot(reading);
      await Effect.runPromise(Deferred.await(manifestRead));
      // Commit the new generation after reading the old manifest, before reading its chunks.
      await writeNativeWorkspaceSnapshot(writing, next);
      pause = false;
      await Effect.runPromise(Deferred.succeed(continueRead, undefined));
      assert.equal(await read, previous);
      assert.equal(await readNativeWorkspaceSnapshot(reading), next);
    } finally {
      reader.close();
      writer.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
