import { Effect, Schema } from "effect";
import * as SQLite from "expo-sqlite";
import { emptyLibraryNotes, LibraryNotesSchema, type LibraryNotesStore } from "@recall/application";
import type { MediaStore } from "@recall/local-store";
import { withNativeOperationStoreLane } from "./native-operation-store";

const prefix = "library-notes:";
const failure = () =>
  ({
    _tag: "LibraryNotesFailure",
    message:
      "Drafts, activities, and card flags could not be saved on this device. Your open draft is still here. Retry before closing the app.",
  }) as const;
const table =
  "CREATE TABLE IF NOT EXISTS local_key_value (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL)";
export function createNativeLibraryNotesStore(
  scope: string,
  mayWrite: () => boolean,
  mediaStore: MediaStore | null,
  recordOwner = scope,
): LibraryNotesStore {
  return {
    scope,
    read: Effect.suspend(() =>
      mayWrite()
        ? Effect.tryPromise({
            try: async () => {
              const database = await SQLite.openDatabaseAsync("recall.db");
              await database.execAsync(table);
              const row = await database.getFirstAsync<{ readonly value: string }>(
                "SELECT value FROM local_key_value WHERE key = ?",
                `${prefix}${recordOwner}`,
              );
              return row?.value ?? null;
            },
            catch: failure,
          }).pipe(
            Effect.flatMap((raw) =>
              raw === null
                ? Effect.succeed(emptyLibraryNotes)
                : Schema.decodeUnknown(Schema.parseJson(LibraryNotesSchema))(raw).pipe(
                    Effect.mapError(failure),
                  ),
            ),
          )
        : Effect.fail(failure()),
    ),
    write: (input, assets = []) =>
      withNativeOperationStoreLane(
        Effect.gen(function* () {
          if (!mayWrite()) return yield* Effect.fail(failure());
          const notes = yield* Schema.decodeUnknown(LibraryNotesSchema)(input).pipe(
            Effect.mapError(failure),
          );
          if (assets.length > 0 && !mediaStore) return yield* Effect.fail(failure());
          if (mediaStore)
            yield* Effect.forEach(
              assets,
              (asset) => mediaStore.put(asset).pipe(Effect.mapError(failure)),
              { discard: true },
            );
          yield* Effect.tryPromise({
            try: async () => {
              const database = await SQLite.openDatabaseAsync("recall.db");
              await database.execAsync(table);
              let saved = false;
              await database.withExclusiveTransactionAsync(async (transaction) => {
                if (!mayWrite()) return;
                await transaction.runAsync(
                  "INSERT INTO local_key_value (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                  `${prefix}${recordOwner}`,
                  JSON.stringify(notes),
                  new Date().toISOString(),
                );
                saved = true;
              });
              return saved;
            },
            catch: failure,
          }).pipe(Effect.flatMap((saved) => (saved ? Effect.void : Effect.fail(failure()))));
          return notes;
        }),
      ),
  };
}
export const clearNativeLibraryNotes = withNativeOperationStoreLane(
  Effect.tryPromise({
    try: async () => {
      const database = await SQLite.openDatabaseAsync("recall.db");
      await database.execAsync(table);
      await database.runAsync("DELETE FROM local_key_value WHERE key LIKE ?", `${prefix}%`);
    },
    catch: failure,
  }),
);
