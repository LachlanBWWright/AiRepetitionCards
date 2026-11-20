import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  readDesktopWorkspaceSnapshot,
  writeDesktopWorkspaceSnapshot,
} from "../../../../apps/desktop/src/main/ipc/workspace-snapshot-chunks";
import { clearDesktopWorkspace } from "../../../../apps/desktop/src/main/ipc/workspace-clear";

function open(file: string) {
  const database = new DatabaseSync(file);
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS local_workspace(id INTEGER PRIMARY KEY,serialized_workspace TEXT,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS local_workspace_chunks(part INTEGER PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_checkpoints(id INTEGER PRIMARY KEY,entries TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_checkpoint_chunks(part INTEGER PRIMARY KEY,payload TEXT NOT NULL);`);
  return database;
}
const workerFile = process.env.RECALL_CRASH_DATABASE;
if (workerFile) {
  const database = open(workerFile);
  database.function("interrupt_write", () => {
    // Notify synchronously, then hold the actual adapter inside a SQLite write transaction.
    process.stdout.write("transaction-open\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    return 0;
  });
  database.exec(`CREATE TEMP TRIGGER stop_during_save BEFORE INSERT ON local_workspace_chunks
    WHEN new.part=1 BEGIN SELECT interrupt_write(); END;`);
  writeDesktopWorkspaceSnapshot(database, "replacement".repeat(30_000));
  process.exit(2);
} else {
  await test(
    "killing the process midway through a chunked save recovers the last acknowledged snapshot",
    { timeout: 20_000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "recall-crash-"));
      const file = join(directory, "workspace.db");
      const previous = "offline review history 🙂".repeat(10_000);
      const initial = open(file);
      assert.equal(writeDesktopWorkspaceSnapshot(initial, previous), true);
      initial.close();
      const child = spawn(process.execPath, [process.argv[1] ?? ""], {
        env: { ...process.env, RECALL_CRASH_DATABASE: file },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const exited = once(child, "exit");
      try {
        const output = child.stdout;
        assert.ok(output);
        const reached = await Promise.race([
          once(output, "data", { signal: AbortSignal.timeout(10_000) }).then(
            ([bytes]: readonly unknown[]) => String(bytes),
          ),
          exited.then(() => "worker exited early"),
        ]);
        assert.match(reached, /transaction-open/);
        child.kill("SIGKILL");
        await exited;
        const recovered = open(file);
        try {
          assert.equal(readDesktopWorkspaceSnapshot(recovered), previous);
          assert.equal(recovered.prepare("PRAGMA quick_check").get()?.quick_check, "ok");
          assert.equal(writeDesktopWorkspaceSnapshot(recovered, "resumed"), true);
          assert.equal(readDesktopWorkspaceSnapshot(recovered), "resumed");
        } finally {
          recovered.close();
        }
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await exited;
        }
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  await test("failed workspace clearing preserves both saved data and recovery checkpoints", () => {
    const database = open(":memory:");
    try {
      assert.equal(writeDesktopWorkspaceSnapshot(database, "saved reviews"), true);
      database.exec(
        "INSERT INTO workspace_checkpoints VALUES(1,'archive'); INSERT INTO workspace_checkpoint_chunks VALUES(0,'recovery');",
      );
      database.exec(
        "CREATE TRIGGER reject_clear BEFORE DELETE ON local_workspace BEGIN SELECT RAISE(ABORT,'storage unavailable'); END;",
      );
      assert.equal(clearDesktopWorkspace(database), false);
      assert.equal(readDesktopWorkspaceSnapshot(database), "saved reviews");
      assert.equal(
        database.prepare("SELECT entries FROM workspace_checkpoints").get()?.entries,
        "archive",
      );
      assert.equal(
        database.prepare("SELECT payload FROM workspace_checkpoint_chunks").get()?.payload,
        "recovery",
      );
      database.exec("DROP TRIGGER reject_clear");
      assert.equal(clearDesktopWorkspace(database), true);
      assert.equal(readDesktopWorkspaceSnapshot(database), null);
      assert.equal(database.prepare("SELECT count(*) n FROM workspace_checkpoints").get()?.n, 0);
    } finally {
      database.close();
    }
  });
}
