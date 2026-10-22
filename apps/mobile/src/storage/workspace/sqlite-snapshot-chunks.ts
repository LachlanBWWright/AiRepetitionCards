import type * as SQLite from "expo-sqlite";
import {
  joinWorkspaceChunks,
  splitWorkspacePayload,
  workspaceChunkCount,
  workspaceChunkManifest,
} from "@recall/local-store";
export async function readNativeWorkspaceSnapshot(
  database: SQLite.SQLiteDatabase,
): Promise<string | null | undefined> {
  const row = await database.getFirstAsync<{ serialized_workspace: string }>(
    "SELECT serialized_workspace FROM workspace_snapshot WHERE id=1",
  );
  if (!row) return null;
  const count = workspaceChunkCount(row.serialized_workspace);
  if (count === undefined) return row.serialized_workspace;
  const rows = await database.getAllAsync<{ part: number; payload: string }>(
    "SELECT part,payload FROM workspace_snapshot_chunks ORDER BY part",
  );
  return joinWorkspaceChunks(rows, count);
}
export async function writeNativeWorkspaceSnapshot(
  database: SQLite.SQLiteDatabase,
  serialized: string,
): Promise<void> {
  const chunks = splitWorkspacePayload(serialized);
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync("DELETE FROM workspace_snapshot_chunks");
    for (const [index, chunk] of chunks.entries())
      await transaction.runAsync(
        "INSERT INTO workspace_snapshot_chunks(part,payload) VALUES(?,?)",
        index,
        chunk,
      );
    await transaction.runAsync(
      "INSERT INTO workspace_snapshot(id,serialized_workspace,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET serialized_workspace=excluded.serialized_workspace,updated_at=excluded.updated_at",
      workspaceChunkManifest(chunks.length),
      new Date().toISOString(),
    );
  });
}
