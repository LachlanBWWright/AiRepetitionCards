import { readCheckpointArchive } from "./workspace-checkpoint-storage";
export { captureDesktopCheckpoint } from "./workspace-checkpoint-storage";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { DatabaseSync } from "node:sqlite";
import { Effect, Either, Schema } from "effect";
import { WorkspaceCheckpointsSchema } from "@recall/local-store";

export function registerCheckpointIpc(
  database: DatabaseSync,
  trusted: (event: IpcMainInvokeEvent) => boolean,
): void {
  database.exec(
    "CREATE TABLE IF NOT EXISTS workspace_checkpoints (id INTEGER PRIMARY KEY CHECK(id = 1), entries TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workspace_checkpoint_chunks (part INTEGER PRIMARY KEY,payload TEXT NOT NULL)",
  );
  ipcMain.handle("workspace:integrity", (event) => {
    if (!trusted(event)) return { _tag: "Failure" };
    const checked = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => database.prepare("PRAGMA quick_check").all(),
          catch: () => "read" as const,
        }),
      ),
    );
    return Either.isRight(checked) &&
      checked.right.length === 1 &&
      checked.right[0]?.quick_check === "ok"
      ? { _tag: "Success" }
      : { _tag: "Failure" };
  });
  ipcMain.handle("workspace:checkpoints", (event) => {
    if (!trusted(event)) return { _tag: "Failure" };
    const result = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () =>
            Schema.decodeUnknownEither(WorkspaceCheckpointsSchema)(readCheckpointArchive(database)),
          catch: () => "read" as const,
        }),
      ),
    );
    return Either.isRight(result) && Either.isRight(result.right)
      ? { _tag: "Success", value: result.right.right }
      : { _tag: "Failure" };
  });
}
