import * as SQLite from "expo-sqlite";

const table =
  "CREATE TABLE IF NOT EXISTS local_key_value (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL)";

/** Callers classify vendor failures; the captured owner is checked inside the transaction. */
export async function writeNativeKeyValue(
  key: string,
  value: string,
  mayWrite: () => boolean,
): Promise<boolean> {
  const database = await SQLite.openDatabaseAsync("recall.db");
  await database.execAsync(table);
  let written = false;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    if (!mayWrite()) return;
    await transaction.runAsync(
      "INSERT INTO local_key_value (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      key,
      value,
      new Date().toISOString(),
    );
    written = true;
  });
  return written;
}
