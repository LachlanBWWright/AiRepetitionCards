import { ankiSqliteAssetPath } from "./browser-anki-sqlite-assets";
import initSqlJs from "sql.js";
import { Effect } from "effect";
import type { AnkiSqliteWriter, AnkiExportFailure } from "@recall/application";

export const writeAnkiSqliteInBrowser: AnkiSqliteWriter = (statements) =>
  Effect.tryPromise({
    try: async () => {
      const sqlite = await initSqlJs({
        locateFile: ankiSqliteAssetPath,
      });
      const database = new sqlite.Database();
      try {
        for (const statement of statements) {
          if (statement.parameters.length === 0) database.exec(statement.sql);
          else database.run(statement.sql, [...statement.parameters]);
        }
        return database.export();
      } finally {
        database.close();
      }
    },
    catch: (): AnkiExportFailure => ({ _tag: "AnkiExportFailure", reason: "database-failed" }),
  });
