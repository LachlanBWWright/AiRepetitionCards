import {
  joinWorkspaceChunks,
  splitWorkspacePayload,
  workspaceChunkCount,
  workspaceChunkManifest,
} from "@recall/local-store";
export interface NativeSnapshotTransaction {
  readonly getFirstAsync: (
    source: string,
  ) => Promise<{ readonly serialized_workspace: string } | null>;
  readonly getAllAsync: (
    source: string,
  ) => Promise<readonly { readonly part: number; readonly payload: string }[]>;
  readonly runAsync: (
    source: string,
    ...parameters: readonly (string | number)[]
  ) => Promise<unknown>;
}
export interface NativeSnapshotDatabase {
  readonly withExclusiveTransactionAsync: (
    work: (transaction: NativeSnapshotTransaction) => Promise<void>,
  ) => Promise<void>;
}

/** Read the manifest and chunks in one snapshot, even when another connection commits a save. */
export async function readNativeWorkspaceSnapshot(
  database: NativeSnapshotDatabase,
): Promise<string | null | undefined> {
  const result: { value: string | null | undefined } = { value: null };
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const row = await transaction.getFirstAsync(
      "SELECT serialized_workspace FROM workspace_snapshot WHERE id=1",
    );
    if (!row) return;
    const count = workspaceChunkCount(row.serialized_workspace);
    if (count === undefined) {
      result.value = row.serialized_workspace;
      return;
    }
    const rows = await transaction.getAllAsync(
      "SELECT part,payload FROM workspace_snapshot_chunks ORDER BY part",
    );
    result.value = joinWorkspaceChunks(rows, count);
  });
  return result.value;
}
export async function writeNativeWorkspaceSnapshot(
  database: NativeSnapshotDatabase,
  serialized: string,
): Promise<void> {
  const chunks = splitWorkspacePayload(serialized);
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      "DELETE FROM workspace_snapshot_chunks WHERE part >= ?",
      chunks.length,
    );
    for (const [index, chunk] of chunks.entries())
      await transaction.runAsync(
        "INSERT INTO workspace_snapshot_chunks(part,payload) VALUES(?,?) ON CONFLICT(part) DO UPDATE SET payload=excluded.payload WHERE payload != excluded.payload",
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
