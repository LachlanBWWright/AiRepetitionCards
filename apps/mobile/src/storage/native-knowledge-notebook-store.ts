import { Effect, Either, Schema } from "effect";
import * as SQLite from "expo-sqlite";
import type { AreaId } from "@recall/domain";
import { KnowledgeNotebookSchema, type KnowledgeNotebook } from "@recall/application";
import { withNativeOperationStoreLane } from "./native-operation-store";

const databaseName = "recall.db";
const notebookNamespace = "knowledge-notebook";
export type NativeKnowledgeNotebookStoreFailure = {
  readonly _tag: "NativeKnowledgeNotebookStoreFailure";
};

const failure = (): NativeKnowledgeNotebookStoreFailure => ({
  _tag: "NativeKnowledgeNotebookStoreFailure",
});
const areaKey = (areaId: AreaId, namespace = notebookNamespace) => `${namespace}:${areaId}`;

/** Read one local notebook record as untrusted JSON for application schema validation. */
export function readNativeKnowledgeNotebook(
  areaId: AreaId,
  namespace = notebookNamespace,
): Effect.Effect<KnowledgeNotebook | null, NativeKnowledgeNotebookStoreFailure> {
  const operation = Effect.tryPromise({
    try: async () => {
      const database = await SQLite.openDatabaseAsync(databaseName);
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS local_key_value (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      const row = await database.getFirstAsync<{ readonly value: string }>(
        "SELECT value FROM local_key_value WHERE key = ?",
        areaKey(areaId, namespace),
      );
      if (!row) return { _tag: "Missing" } as const;
      const decoded = Schema.decodeUnknownEither(Schema.parseJson(KnowledgeNotebookSchema))(
        row.value,
      );
      if (Either.isLeft(decoded) || decoded.right.areaId !== areaId)
        return { _tag: "Invalid" } as const;
      return { _tag: "Found", notebook: decoded.right } as const;
    },
    catch: failure,
  });
  return operation.pipe(
    Effect.flatMap((result) =>
      result._tag === "Invalid"
        ? Effect.fail(failure())
        : Effect.succeed(result._tag === "Found" ? result.notebook : null),
    ),
  );
}

/** Persist a validated notebook only while the captured native workspace can still write. */
export function writeNativeKnowledgeNotebook(
  areaId: AreaId,
  notebook: unknown,
  mayWrite: () => boolean,
  namespace = notebookNamespace,
): Effect.Effect<void, NativeKnowledgeNotebookStoreFailure> {
  const decoded = Schema.decodeUnknownEither(KnowledgeNotebookSchema)(notebook);
  if (Either.isLeft(decoded) || decoded.right.areaId !== areaId) return Effect.fail(failure());
  return withNativeOperationStoreLane(
    Effect.suspend(() =>
      mayWrite()
        ? Effect.tryPromise({
            try: async () => {
              const database = await SQLite.openDatabaseAsync(databaseName);
              await database.execAsync(`
                CREATE TABLE IF NOT EXISTS local_key_value (
                  key TEXT PRIMARY KEY NOT NULL,
                  value TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
              `);
              const value = JSON.stringify(decoded.right);
              if (value === undefined) return false;
              let written = false;
              await database.withExclusiveTransactionAsync(async (transaction) => {
                if (!mayWrite()) return;
                await transaction.runAsync(
                  `INSERT INTO local_key_value (key, value, updated_at)
                   VALUES (?, ?, ?)
                   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
                  areaKey(areaId, namespace),
                  value,
                  new Date().toISOString(),
                );
                written = true;
              });
              return written;
            },
            catch: failure,
          }).pipe(Effect.flatMap((written) => (written ? Effect.void : Effect.fail(failure()))))
        : Effect.fail(failure()),
    ),
  );
}

/** Erase local notebook records together with the native tutor session on account deletion. */
export function clearNativeKnowledgeNotebooks(
  areaIds: readonly AreaId[] | null,
  mayWrite: () => boolean = () => true,
): Effect.Effect<void, NativeKnowledgeNotebookStoreFailure> {
  return withNativeOperationStoreLane(
    Effect.tryPromise({
      try: async () => {
        const database = await SQLite.openDatabaseAsync(databaseName);
        await database.execAsync(`
          CREATE TABLE IF NOT EXISTS local_key_value (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
        let cleared = false;
        await database.withExclusiveTransactionAsync(async (transaction) => {
          if (!mayWrite()) return;
          if (areaIds === null)
            await transaction.runAsync(
              "DELETE FROM local_key_value WHERE key LIKE ?",
              `${notebookNamespace}:%`,
            );
          else
            for (const areaId of new Set(areaIds))
              await transaction.runAsync(
                "DELETE FROM local_key_value WHERE key = ? OR key LIKE ?",
                areaKey(areaId),
                `${notebookNamespace}:%:${areaId}`,
              );
          cleared = true;
        });
        return cleared;
      },
      catch: failure,
    }).pipe(Effect.flatMap((cleared) => (cleared ? Effect.void : Effect.fail(failure())))),
  );
}
