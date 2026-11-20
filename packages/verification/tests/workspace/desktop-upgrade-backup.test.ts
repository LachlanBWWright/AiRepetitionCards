import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect, Either } from "effect";
import { prepareUpgradeBackup } from "../../../../apps/desktop/src/main/security/upgrade-backup";

await test("version upgrades retain complete recoverable WAL snapshots including private media", async () => {
  const directory = await mkdtemp(join(tmpdir(), "recall-upgrade-"));
  const database = new DatabaseSync(join(directory, "recall.sqlite"));
  try {
    database.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE local_workspace(id INTEGER PRIMARY KEY, serialized_workspace TEXT);
      INSERT INTO local_workspace VALUES(1,'legacy offline reviews');
      CREATE TABLE media_assets(id TEXT PRIMARY KEY, bytes BLOB);`);
    const bytes = Uint8Array.from([0, 1, 2, 255]);
    database.prepare("INSERT INTO media_assets VALUES(?,?)").run("image", bytes);
    const backups = join(directory, "backups");
    await Effect.runPromise(prepareUpgradeBackup(database, backups, "0.2.0"));
    const names = await readdir(backups);
    assert.equal(names.length, 1);
    const archive = new DatabaseSync(join(backups, names[0] ?? ""), { readOnly: true });
    try {
      assert.equal(archive.prepare("PRAGMA quick_check").get()?.quick_check, "ok");
      assert.equal(
        archive.prepare("SELECT serialized_workspace FROM local_workspace").get()
          ?.serialized_workspace,
        "legacy offline reviews",
      );
      assert.deepEqual(archive.prepare("SELECT bytes FROM media_assets").get()?.bytes, bytes);
    } finally {
      archive.close();
    }
    await Effect.runPromise(prepareUpgradeBackup(database, backups, "0.2.0"));
    assert.deepEqual(
      (await readdir(backups)).filter((name) => name.endsWith(".sqlite")),
      names,
    );
    assert.equal(database.prepare("SELECT version FROM app_version").get()?.version, "0.2.0");
    const blocked = join(directory, "not-a-directory");
    await writeFile(blocked, "occupied");
    const rejected = await Effect.runPromise(
      Effect.either(prepareUpgradeBackup(database, blocked, "0.3.0")),
    );
    assert.ok(Either.isLeft(rejected));
    assert.equal(database.prepare("SELECT version FROM app_version").get()?.version, "0.2.0");
    assert.equal(
      database.prepare("SELECT serialized_workspace FROM local_workspace").get()
        ?.serialized_workspace,
      "legacy offline reviews",
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
