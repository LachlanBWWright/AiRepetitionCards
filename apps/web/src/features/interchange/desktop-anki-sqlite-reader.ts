import { Effect } from "effect";
import type { AnkiSqliteReader, AnkiSqliteReaderError } from "@recall/application";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const failure = (): AnkiSqliteReaderError => ({
  _tag: "AnkiSqliteReaderError",
  reason: "invalid-database",
});

/** Calls the Electron main-process SQLite adapter through the narrow preload bridge. */
export const readAnkiSqliteOnDesktop: AnkiSqliteReader = (database) =>
  Effect.tryPromise({
    try: async () => {
      const bridge = window.recallDesktop;
      if (!bridge) return null;
      const response = await bridge.anki.readSqlite(database.slice());
      if (!isRecord(response) || response._tag !== "Success" || !("value" in response)) {
        return null;
      }
      return response.value;
    },
    catch: failure,
  }).pipe(
    Effect.flatMap((value) => (value === null ? Effect.fail(failure()) : Effect.succeed(value))),
  );
