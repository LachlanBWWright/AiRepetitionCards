import { Effect } from "effect";
import * as SQLite from "expo-sqlite";
import { createTutorConversationStore } from "@recall/application";
import { withNativeOperationStoreLane } from "../workspace/native-operation-store";
const table =
  "CREATE TABLE IF NOT EXISTS local_key_value (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL)";
const failure = {
  message:
    "The saved conversation could not be read or written on this device. Your open messages remain available.",
};

export function createNativeTutorConversationStore(
  scope: string,
  areaId: string,
  mayWrite: () => boolean,
) {
  const key = `tutor-conversation:${JSON.stringify([scope, areaId])}`;
  return createTutorConversationStore(scope, areaId, {
    read: Effect.tryPromise({
      try: async () => {
        const db = await SQLite.openDatabaseAsync("recall.db");
        await db.execAsync(table);
        if (!mayWrite()) return null;
        return (
          (
            await db.getFirstAsync<{ readonly value: string }>(
              "SELECT value FROM local_key_value WHERE key = ?",
              key,
            )
          )?.value ?? null
        );
      },
      catch: () => failure,
    }),
    commit: (expected, next) =>
      withNativeOperationStoreLane(
        Effect.tryPromise({
          try: () => commitConversation(key, expected, next, mayWrite),
          catch: () => failure,
        }).pipe(Effect.flatMap((saved) => (saved ? Effect.void : Effect.fail(failure)))),
      ),
  });
}

async function commitConversation(
  key: string,
  expected: string | null,
  next: string | null,
  mayWrite: () => boolean,
) {
  const db = await SQLite.openDatabaseAsync("recall.db");
  await db.execAsync(table);
  let saved = false;
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (!mayWrite()) return;
    const current = await tx.getFirstAsync<{ readonly value: string }>(
      "SELECT value FROM local_key_value WHERE key = ?",
      key,
    );
    if ((current?.value ?? null) !== expected) return;
    if (next === null) await tx.runAsync("DELETE FROM local_key_value WHERE key = ?", key);
    else
      await tx.runAsync(
        "INSERT INTO local_key_value(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        key,
        next,
        new Date().toISOString(),
      );
    saved = true;
  });
  return saved;
}
