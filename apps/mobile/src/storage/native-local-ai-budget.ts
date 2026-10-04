import { Effect } from "effect";
import * as SQLite from "expo-sqlite";
import {
  createLocalBudgetService,
  decodeLocalBudgetRecord,
  localBudgetFailure,
} from "@recall/application";
import { withNativeOperationStoreLane } from "./native-operation-store";

export const nativeLocalBudget = createLocalBudgetService((update) =>
  withNativeOperationStoreLane(
    Effect.gen(function* () {
      const database = yield* Effect.tryPromise({
        try: () => SQLite.openDatabaseAsync("recall.db"),
        catch: () => localBudgetFailure(),
      });
      yield* Effect.tryPromise({
        try: () =>
          database.execAsync(
            "CREATE TABLE IF NOT EXISTS local_key_value (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
          ),
        catch: () => localBudgetFailure(),
      });
      const row = yield* Effect.tryPromise({
        try: () =>
          database.getFirstAsync<{ readonly value: string }>(
            "SELECT value FROM local_key_value WHERE key = ?",
            "local-ai-usage",
          ),
        catch: () => localBudgetFailure(),
      });
      const state = yield* decodeLocalBudgetRecord(row?.value ?? null);
      const result = yield* update(state);
      if (result.state !== state)
        yield* Effect.tryPromise({
          try: () =>
            database.runAsync(
              "INSERT INTO local_key_value (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
              "local-ai-usage",
              JSON.stringify(result.state),
              new Date().toISOString(),
            ),
          catch: () => localBudgetFailure(),
        });
      return result.value;
    }),
  ),
);

/** Explicit device erasure removes usage and policies together. */
export const clearNativeLocalBudget = withNativeOperationStoreLane(
  Effect.tryPromise({
    try: async () => {
      const database = await SQLite.openDatabaseAsync("recall.db");
      await database.execAsync(
        "CREATE TABLE IF NOT EXISTS local_key_value (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
      );
      await database.runAsync("DELETE FROM local_key_value WHERE key = ?", "local-ai-usage");
    },
    catch: () => localBudgetFailure("Could not remove local AI usage and budget settings."),
  }),
);
