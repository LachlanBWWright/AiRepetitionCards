import type { DatabaseSync } from "node:sqlite";
import { Effect, Either, Schema } from "effect";
import {
  WorkspaceCheckpointsSchema,
  retainedWorkspaceCheckpoints,
  joinWorkspaceChunks,
  splitWorkspacePayload,
  workspaceChunkCount,
  workspaceChunkManifest,
} from "@recall/local-store";
import { parseWorkspaceJson } from "@recall/domain";
import { readDesktopWorkspaceSnapshot } from "./workspace-snapshot-chunks";

export function readCheckpointArchive(database: DatabaseSync): unknown {
  const row = database.prepare("SELECT entries FROM workspace_checkpoints WHERE id = 1").get();
  if (typeof row?.entries !== "string") return [];
  const count = workspaceChunkCount(row.entries);
  if (count === undefined) return JSON.parse(row.entries) as unknown;
  const raw: unknown[] = database
    .prepare("SELECT part,payload FROM workspace_checkpoint_chunks ORDER BY part")
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
  const serialized = joinWorkspaceChunks(rows, count);
  return serialized === undefined ? null : (JSON.parse(serialized) as unknown);
}
export function captureDesktopCheckpoint(
  database: DatabaseSync,
  serialized: string,
  now: Date,
): boolean {
  if (!Number.isFinite(now.getTime())) return false;
  const decoded = Schema.decodeUnknownEither(WorkspaceCheckpointsSchema)(
    readCheckpointArchive(database),
  );
  if (Either.isLeft(decoded)) return false;
  const entries = decoded.right;
  if (entries.some((entry) => now.getTime() - Date.parse(entry.createdAt) < 30 * 60 * 1000))
    return true;
  const previous = readDesktopWorkspaceSnapshot(database);
  if (previous === undefined) return false;
  const candidate = previous ?? serialized;
  if (Either.isLeft(Effect.runSync(Effect.either(parseWorkspaceJson(candidate))))) return false;
  const next = retainedWorkspaceCheckpoints([
    ...entries,
    { createdAt: now.toISOString(), serializedWorkspace: candidate },
  ]);
  const chunks = splitWorkspacePayload(JSON.stringify(next));
  database.exec("SAVEPOINT workspace_checkpoint_capture");
  const written = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => {
          database.exec("DELETE FROM workspace_checkpoint_chunks");
          const insert = database.prepare(
            "INSERT INTO workspace_checkpoint_chunks(part,payload) VALUES(?,?)",
          );
          for (const [part, payload] of chunks.entries()) insert.run(part, payload);
          database
            .prepare(
              "INSERT INTO workspace_checkpoints (id, entries) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET entries = excluded.entries",
            )
            .run(workspaceChunkManifest(chunks.length));
        },
        catch: () => "write" as const,
      }),
    ),
  );
  if (Either.isLeft(written)) database.exec("ROLLBACK TO workspace_checkpoint_capture");
  database.exec("RELEASE workspace_checkpoint_capture");
  return Either.isRight(written);
}
