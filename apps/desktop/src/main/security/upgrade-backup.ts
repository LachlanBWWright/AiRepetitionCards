import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { backup, type DatabaseSync } from "node:sqlite";
import { Effect } from "effect";

export interface UpgradeBackupFailure {
  readonly _tag: "UpgradeBackupFailure";
}

/** Snapshot the entire SQLite database, including WAL/media, before a new app version runs. */
export function prepareUpgradeBackup(
  database: DatabaseSync,
  directory: string,
  version: string,
): Effect.Effect<void, UpgradeBackupFailure> {
  return Effect.tryPromise({
    try: async () => {
      database.exec(
        "CREATE TABLE IF NOT EXISTS app_version(id INTEGER PRIMARY KEY CHECK(id=1),version TEXT NOT NULL)",
      );
      const previous = database.prepare("SELECT version FROM app_version WHERE id=1").get();
      if (previous?.version === version) return;
      const existing = database.prepare("SELECT count(*) count FROM local_workspace").get();
      if (existing?.count !== 0) {
        await mkdir(directory, { recursive: true });
        // Only generated names enter a path. Each completed backup is retained for manual recovery.
        await backup(database, join(directory, `before-upgrade-${randomUUID()}.sqlite`));
      }
      database
        .prepare(
          "INSERT INTO app_version(id,version) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version",
        )
        .run(version);
    },
    catch: () => ({ _tag: "UpgradeBackupFailure" }) as const,
  });
}
