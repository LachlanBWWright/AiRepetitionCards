import { writeNativeKeyValue } from "../native-key-value-write";
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
    persistenceLocation: () => "native",
    persistenceStatus: () => "saved-locally",
    read: Effect.suspend(() => {
      if (!mayWrite()) return Effect.fail(failure());
      return Effect.tryPromise({
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
      }).pipe(Effect.flatMap(decodeNotes));
    }),
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
            try: () =>
              writeNativeKeyValue(`${prefix}${recordOwner}`, JSON.stringify(notes), mayWrite),
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

function decodeNotes(raw: string | null) {
  if (raw === null) return Effect.succeed(emptyLibraryNotes);
  return Schema.decodeUnknown(Schema.parseJson(LibraryNotesSchema))(raw).pipe(
    Effect.mapError(failure),
  );
}
