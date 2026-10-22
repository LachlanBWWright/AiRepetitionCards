import { Effect, Either } from "effect";
import {
  joinWorkspaceChunks,
  splitWorkspacePayload,
  workspaceChunkCount,
  workspaceChunkManifest,
} from "@recall/local-store";
import type { DatabaseSync } from "node:sqlite";
export function readDesktopWorkspaceSnapshot(database: DatabaseSync): string | null | undefined {
  const row: unknown = database
    .prepare("SELECT serialized_workspace FROM local_workspace WHERE id=1")
    .get();
  if (
    typeof row !== "object" ||
    row === null ||
    !("serialized_workspace" in row) ||
    typeof row.serialized_workspace !== "string"
  )
    return null;
  const count = workspaceChunkCount(row.serialized_workspace);
  if (count === undefined) return row.serialized_workspace;
  const raw: unknown[] = database
    .prepare("SELECT part,payload FROM local_workspace_chunks ORDER BY part")
    .all();
  const rows = raw.flatMap((item) =>
    typeof item === "object" &&
    item !== null &&
    "part" in item &&
    typeof item.part === "number" &&
    "payload" in item &&
    typeof item.payload === "string"
      ? [{ part: item.part, payload: item.payload }]
      : [],
  );
  return joinWorkspaceChunks(rows, count);
}
export function writeDesktopWorkspaceSnapshot(database: DatabaseSync, serialized: string): boolean {
  const savepoint: { active: boolean } = { active: false };
  const result = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => {
          database.exec("SAVEPOINT workspace_snapshot_write");
          savepoint.active = true;
          const chunks = splitWorkspacePayload(serialized);
          database.exec("DELETE FROM local_workspace_chunks");
          const insert = database.prepare(
            "INSERT INTO local_workspace_chunks(part,payload) VALUES(?,?)",
          );
          for (const [index, chunk] of chunks.entries()) insert.run(index, chunk);
          database
            .prepare(
              "INSERT INTO local_workspace(id,serialized_workspace,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET serialized_workspace=excluded.serialized_workspace,updated_at=excluded.updated_at",
            )
            .run(workspaceChunkManifest(chunks.length), new Date().toISOString());
          database.exec("RELEASE workspace_snapshot_write");
          savepoint.active = false;
        },
        catch: () => ({ reason: "workspace-write" }),
      }),
    ),
  );
  if (Either.isRight(result)) return true;
  if (savepoint.active)
    Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => {
            database.exec("ROLLBACK TO workspace_snapshot_write; RELEASE workspace_snapshot_write");
          },
          catch: () => ({ reason: "workspace-write" }),
        }),
      ),
    );
  return false;
}
