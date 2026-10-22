import * as SQLite from "expo-sqlite";
import { Effect } from "effect";
import type { AnkiSqliteWriter, AnkiExportFailure } from "@recall/application";

export const writeAnkiSqliteInNative: AnkiSqliteWriter = (statements) =>
  Effect.tryPromise({
    try: async () => {
      const database = await SQLite.openDatabaseAsync(":memory:", { useNewConnection: true });
      try {
        for (const statement of statements) {
          if (statement.parameters.length === 0) await database.execAsync(statement.sql);
          else await database.runAsync(statement.sql, [...statement.parameters]);
        }
        return await database.serializeAsync();
      } finally {
        await database.closeAsync();
      }
    },
    catch: (): AnkiExportFailure => ({ _tag: "AnkiExportFailure", reason: "database-failed" }),
  });
