import {
  readDesktopWorkspaceSnapshot,
  writeDesktopWorkspaceSnapshot,
} from "./workspace-snapshot-chunks";
import { registerCheckpointIpc, captureDesktopCheckpoint } from "./workspace-checkpoint-ipc";
import { Buffer } from "node:buffer";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { Effect, Either, Schema } from "effect";
import { parseWorkspaceJson, MAX_LOCAL_WORKSPACE_BYTES } from "@recall/domain";
import type { DatabaseSync } from "node:sqlite";

type DesktopReply<T> =
  { readonly _tag: "Success"; readonly value: T } | { readonly _tag: "Failure" };

function failure<T>(): DesktopReply<T> {
  return { _tag: "Failure" };
}

export function registerWorkspaceIpc(
  database: DatabaseSync,
  trustedSender: (event: IpcMainInvokeEvent) => boolean,
  clearReminders: () => Promise<boolean>,
): void {
  database.exec(
    "CREATE TABLE IF NOT EXISTS local_workspace_chunks(part INTEGER PRIMARY KEY,payload TEXT NOT NULL)",
  );
  registerCheckpointIpc(database, trustedSender);
  ipcMain.handle("workspace:read", (event): DesktopReply<string | null> => {
    if (!trustedSender(event)) return failure();
    const result = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => {
            return readDesktopWorkspaceSnapshot(database);
          },
          catch: () => ({ _tag: "WorkspaceReadFailure" }) as const,
        }),
      ),
    );
    return Either.isRight(result) && result.right !== undefined
      ? { _tag: "Success", value: result.right }
      : failure();
  });

  ipcMain.handle("workspace:write", async (event, input: unknown): Promise<DesktopReply<void>> => {
    if (!trustedSender(event)) return failure();
    const serialized = Schema.decodeUnknownEither(Schema.String)(input);
    if (
      Either.isLeft(serialized) ||
      Buffer.byteLength(serialized.right, "utf8") > MAX_LOCAL_WORKSPACE_BYTES
    ) {
      return failure();
    }
    const decoded = await Effect.runPromise(Effect.either(parseWorkspaceJson(serialized.right)));
    if (Either.isLeft(decoded)) return failure();
    const write = Effect.try({
      try: () => {
        if (!captureDesktopCheckpoint(database, serialized.right, new Date())) return false;
        return writeDesktopWorkspaceSnapshot(database, serialized.right);
      },
      catch: () => ({ _tag: "WorkspaceWriteFailure" }) as const,
    });
    const result = Effect.runSync(Effect.either(write));
    return Either.isRight(result) && result.right
      ? { _tag: "Success", value: undefined }
      : failure();
  });

  ipcMain.handle("workspace:clear", async (event): Promise<DesktopReply<void>> => {
    if (!trustedSender(event)) return failure();
    if (!(await clearReminders())) return failure();
    const result = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => {
            database.prepare("DELETE FROM workspace_checkpoints").run();
            database.prepare("DELETE FROM workspace_checkpoint_chunks").run();
            database.prepare("DELETE FROM local_workspace WHERE id = 1").run();
            database.prepare("DELETE FROM local_workspace_chunks").run();
          },
          catch: () => ({ _tag: "WorkspaceClearFailure" }) as const,
        }),
      ),
    );
    return Either.isRight(result) ? { _tag: "Success", value: undefined } : failure();
  });
}
