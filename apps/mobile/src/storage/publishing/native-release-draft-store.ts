import { Effect } from "effect";
import type { ReleaseDraftStore } from "@recall/application";
import * as SQLite from "expo-sqlite";
import { withNativeOperationStoreLane } from "../workspace/native-operation-store";

const databaseName = "recall.db";
const failure = () => ({ _tag: "ReleaseDraftStorageFailure" }) as const;
const database = Effect.tryPromise({
  try: () => SQLite.openDatabaseAsync(databaseName),
  catch: failure,
});
const ensureTable = (db: SQLite.SQLiteDatabase) =>
  db.execAsync(
    "CREATE TABLE IF NOT EXISTS recall_release_drafts (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  );
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** SQLite storage supports bounded form and portable baseline records beyond secure-store limits. */
export const nativeReleaseDraftStore: ReleaseDraftStore = {
  read: (id) =>
    withNativeOperationStoreLane(
      database.pipe(
        Effect.flatMap((db) =>
          Effect.tryPromise({
            try: async () => {
              await ensureTable(db);
              const row: unknown = await db.getFirstAsync(
                "SELECT value FROM recall_release_drafts WHERE id = ?",
                id,
              );
              return isRecord(row) && typeof row.value === "string" ? row.value : null;
            },
            catch: failure,
          }),
        ),
      ),
    ),
  write: (id, value) =>
    withNativeOperationStoreLane(
      database.pipe(
        Effect.flatMap((db) =>
          Effect.tryPromise({
            try: async () => {
              await ensureTable(db);
              await db.runAsync(
                "INSERT INTO recall_release_drafts (id, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                id,
                value,
                Date.now(),
              );
              const separator = id.indexOf("--");
              const prefix = `${separator < 0 ? "local" : id.slice(0, separator)}--%`;
              await db.runAsync(
                "DELETE FROM recall_release_drafts WHERE id LIKE ? AND id NOT IN (SELECT id FROM recall_release_drafts WHERE id LIKE ? ORDER BY updated_at DESC LIMIT 50)",
                prefix,
                prefix,
              );
            },
            catch: failure,
          }),
        ),
      ),
    ),
  clear: (id) =>
    withNativeOperationStoreLane(
      database.pipe(
        Effect.flatMap((db) =>
          Effect.tryPromise({
            try: async () => {
              await ensureTable(db);
              await db.runAsync("DELETE FROM recall_release_drafts WHERE id = ?", id);
            },
            catch: failure,
          }),
        ),
      ),
    ),
};

export const clearNativeReleaseDrafts = withNativeOperationStoreLane(
  database.pipe(
    Effect.flatMap((db) =>
      Effect.tryPromise({
        try: async () => {
          await ensureTable(db);
          await db.runAsync("DELETE FROM recall_release_drafts");
        },
        catch: failure,
      }),
    ),
  ),
);
