import { Effect } from "effect";
import * as SQLite from "expo-sqlite";
import type { TutorApiFailure } from "@recall/application";
import { withNativeOperationStoreLane } from "../workspace/native-operation-store";

const failure = (): TutorApiFailure => ({
  _tag: "TutorApiFailure",
  reason: "http",
  status: 503,
  code: "Local practice could not be saved. Check device storage and retry.",
});
const open = () =>
  Effect.tryPromise({
    try: async () => {
      const db = await SQLite.openDatabaseAsync("recall.db");
      await db.execAsync(
        "CREATE TABLE IF NOT EXISTS chatgpt_tutor_state (client_id TEXT NOT NULL, area_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (client_id, area_id, key));",
      );
      return db;
    },
    catch: failure,
  });
export function createNativeChatGPTTutorStore(
  clientId: string,
  areaId: string,
  mayWrite: () => boolean,
) {
  return {
    read: (key: string) =>
      Effect.gen(function* () {
        const db = yield* open();
        const row = yield* Effect.tryPromise({
          try: () =>
            db.getFirstAsync<{ readonly value: string }>(
              "SELECT value FROM chatgpt_tutor_state WHERE client_id = ? AND area_id = ? AND key = ?",
              clientId,
              areaId,
              key,
            ),
          catch: failure,
        });
        return row?.value ?? null;
      }),
    write: (entries: readonly (readonly [string, string])[]) =>
      withNativeOperationStoreLane(
        Effect.gen(function* () {
          if (!mayWrite()) return yield* Effect.fail(failure());
          const db = yield* open();
          const written = yield* Effect.tryPromise({
            try: () => persistEntries(db, clientId, areaId, entries, mayWrite),
            catch: failure,
          });
          if (!written) return yield* Effect.fail(failure());
        }),
      ),
  };
}
export const clearNativeChatGPTTutorState = withNativeOperationStoreLane(
  Effect.gen(function* () {
    const db = yield* open();
    yield* Effect.tryPromise({
      try: () => db.runAsync("DELETE FROM chatgpt_tutor_state"),
      catch: failure,
    });
  }),
);

async function persistEntries(
  database: SQLite.SQLiteDatabase,
  clientId: string,
  areaId: string,
  entries: readonly (readonly [string, string])[],
  mayWrite: () => boolean,
): Promise<boolean> {
  let saved = false;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    if (!mayWrite()) return;
    for (const [key, value] of entries)
      await transaction.runAsync(
        "INSERT INTO chatgpt_tutor_state (client_id, area_id, key, value) VALUES (?, ?, ?, ?) ON CONFLICT(client_id, area_id, key) DO UPDATE SET value = excluded.value",
        clientId,
        areaId,
        key,
        value,
      );
    saved = true;
  });
  return saved;
}
