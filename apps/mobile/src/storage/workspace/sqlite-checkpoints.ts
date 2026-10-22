import { Effect, Schema } from "effect";
import type * as SQLite from "expo-sqlite";
import {
  WorkspaceCheckpointsSchema,
  joinWorkspaceChunks,
  splitWorkspacePayload,
  workspaceChunkCount,
  workspaceChunkManifest,
  type WorkspaceCheckpointStore,
} from "@recall/local-store";
export function sqliteCheckpoints(database: SQLite.SQLiteDatabase): WorkspaceCheckpointStore {
  return {
    durable: true,
    read: Effect.tryPromise({
      try: async (): Promise<unknown> => {
        const row = await database.getFirstAsync<{ entries: string }>(
          "SELECT entries FROM workspace_checkpoints WHERE id = 1",
        );
        if (!row) return [];
        const count = workspaceChunkCount(row.entries);
        if (count === undefined) return JSON.parse(row.entries) as unknown;
        const chunks = await database.getAllAsync<{ part: number; payload: string }>(
          "SELECT part,payload FROM workspace_checkpoint_chunks ORDER BY part",
        );
        const serialized = joinWorkspaceChunks(chunks, count);
        return serialized === undefined ? null : (JSON.parse(serialized) as unknown);
      },
      catch: () => ({ _tag: "LocalStoreFailure", operation: "read" }) as const,
    }).pipe(
      Effect.flatMap((value) => Schema.decodeUnknown(WorkspaceCheckpointsSchema)(value)),
      Effect.mapError(() => ({ _tag: "LocalStoreFailure", operation: "read" }) as const),
    ),
    write: (entries) =>
      Effect.tryPromise({
        try: async () => {
          const chunks = splitWorkspacePayload(JSON.stringify(entries));
          await database.withExclusiveTransactionAsync(async (transaction) => {
            await transaction.runAsync("DELETE FROM workspace_checkpoint_chunks");
            for (const [part, payload] of chunks.entries())
              await transaction.runAsync(
                "INSERT INTO workspace_checkpoint_chunks(part,payload) VALUES(?,?)",
                part,
                payload,
              );
            await transaction.runAsync(
              "INSERT INTO workspace_checkpoints (id, entries) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET entries = excluded.entries",
              workspaceChunkManifest(chunks.length),
            );
          });
        },
        catch: () => ({ _tag: "LocalStoreFailure", operation: "write" }) as const,
      }),
  };
}
