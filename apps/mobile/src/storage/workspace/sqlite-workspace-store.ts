import {
  readNativeWorkspaceSnapshot,
  writeNativeWorkspaceSnapshot,
} from "./sqlite-snapshot-chunks";
import { withWorkspaceCheckpoints } from "@recall/local-store";
import { sqliteCheckpoints } from "./sqlite-checkpoints";
import { Effect } from "effect";
import * as SQLite from "expo-sqlite";
import type { LocalStoreFailure, WorkspaceStore } from "@recall/local-store";
import type { MediaId } from "@recall/domain";
import { MediaReferenceSchema, MAX_LOCAL_WORKSPACE_BYTES } from "@recall/domain";
import { Either, Schema } from "effect";
import type { MediaStore, MediaStoreFailure, StoredMediaAsset } from "@recall/local-store";

const databaseName = "recall.db";

function failure(operation: LocalStoreFailure["operation"]): LocalStoreFailure {
  return { _tag: "LocalStoreFailure", operation };
}

export function openSqliteWorkspaceStore(): Effect.Effect<WorkspaceStore, LocalStoreFailure> {
  return Effect.tryPromise({
    try: async () => {
      const database = await SQLite.openDatabaseAsync(databaseName);
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS workspace_snapshot_chunks(part INTEGER PRIMARY KEY,payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS workspace_checkpoints (id INTEGER PRIMARY KEY CHECK(id = 1), entries TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS workspace_checkpoint_chunks (part INTEGER PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS workspace_snapshot (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          serialized_workspace TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      return withWorkspaceCheckpoints(
        createWorkspaceStore(database),
        sqliteCheckpoints(database),
        () => new Date(),
      );
    },
    catch: () => failure("read"),
  });
}

function mediaFailure(operation: MediaStoreFailure["operation"]): MediaStoreFailure {
  return { _tag: "MediaStoreFailure", operation };
}

export function openSqliteMediaStore(): Effect.Effect<MediaStore, MediaStoreFailure> {
  return Effect.tryPromise({
    try: async () => {
      const database = await SQLite.openDatabaseAsync(databaseName);
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS media_assets (
          id TEXT PRIMARY KEY NOT NULL,
          reference_json TEXT NOT NULL,
          bytes BLOB NOT NULL
        );
      `);
      const decodeAsset = (row: {
        reference_json: string;
        bytes: Uint8Array;
      }): StoredMediaAsset | null => {
        const reference = Schema.decodeUnknownEither(MediaReferenceSchema)(
          JSON.parse(row.reference_json) as unknown,
        );
        if (Either.isLeft(reference) || row.bytes.byteLength !== reference.right.byteLength)
          return null;
        return { reference: reference.right, bytes: new Uint8Array(row.bytes) };
      };
      return {
        get: (id: MediaId) =>
          Effect.tryPromise({
            try: async () => {
              const row = await database.getFirstAsync<{
                reference_json: string;
                bytes: Uint8Array;
              }>("SELECT reference_json, bytes FROM media_assets WHERE id = ?", id);
              if (!row) return null;
              const asset = decodeAsset(row);
              return asset?.reference.id === id ? asset : null;
            },
            catch: () => mediaFailure("read"),
          }).pipe(
            Effect.flatMap((asset) =>
              asset === null ? Effect.fail(mediaFailure("read")) : Effect.succeed(asset),
            ),
          ),
        put: (asset) =>
          Effect.tryPromise({
            try: async () => {
              const decoded = Schema.decodeUnknownEither(MediaReferenceSchema)(asset.reference);
              if (Either.isLeft(decoded) || asset.bytes.byteLength !== decoded.right.byteLength)
                return false;
              await database.runAsync(
                "INSERT INTO media_assets (id, reference_json, bytes) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET reference_json = excluded.reference_json, bytes = excluded.bytes",
                decoded.right.id,
                JSON.stringify(decoded.right),
                asset.bytes,
              );
              return true;
            },
            catch: () => mediaFailure("write"),
          }).pipe(
            Effect.flatMap((written) =>
              written ? Effect.void : Effect.fail(mediaFailure("write")),
            ),
          ),
        delete: (id: MediaId) =>
          Effect.tryPromise({
            try: async () => {
              await database.runAsync("DELETE FROM media_assets WHERE id = ?", id);
            },
            catch: () => mediaFailure("delete"),
          }),
        list: Effect.tryPromise({
          try: async () => {
            const rows = await database.getAllAsync<{ reference_json: string; bytes: Uint8Array }>(
              "SELECT reference_json, bytes FROM media_assets",
            );
            const assets = rows.map(decodeAsset);
            return assets.some((asset) => asset === null)
              ? null
              : assets.flatMap((asset) => (asset ? [asset.reference] : []));
          },
          catch: () => mediaFailure("list"),
        }).pipe(
          Effect.flatMap((references) =>
            references === null ? Effect.fail(mediaFailure("list")) : Effect.succeed(references),
          ),
        ),
      } satisfies MediaStore;
    },
    catch: () => mediaFailure("write"),
  });
}

function createWorkspaceStore(database: SQLite.SQLiteDatabase): WorkspaceStore {
  return {
    checkIntegrity: Effect.tryPromise({
      try: () => database.getAllAsync<{ quick_check: string }>("PRAGMA quick_check"),
      catch: () => failure("read"),
    }).pipe(
      Effect.flatMap((rows) =>
        rows.length === 1 && rows[0]?.quick_check === "ok"
          ? Effect.void
          : Effect.fail(failure("read")),
      ),
    ),
    read: Effect.tryPromise({
      try: async () => {
        return readNativeWorkspaceSnapshot(database);
      },
      catch: () => failure("read"),
    }).pipe(
      Effect.flatMap((value) =>
        value === undefined ? Effect.fail(failure("read")) : Effect.succeed(value),
      ),
    ),
    write: (serializedWorkspace) =>
      new TextEncoder().encode(serializedWorkspace).byteLength > MAX_LOCAL_WORKSPACE_BYTES
        ? Effect.fail(failure("write"))
        : Effect.tryPromise({
            try: async () => {
              await writeNativeWorkspaceSnapshot(database, serializedWorkspace);
            },
            catch: () => failure("write"),
          }),
    clear: Effect.tryPromise({
      try: async () => {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          await transaction.runAsync("DELETE FROM workspace_snapshot WHERE id = 1");
          await transaction.runAsync("DELETE FROM workspace_snapshot_chunks");
        });
      },
      catch: () => failure("clear"),
    }),
  } satisfies WorkspaceStore;
}
