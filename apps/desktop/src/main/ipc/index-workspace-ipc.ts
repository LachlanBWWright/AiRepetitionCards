import { Buffer } from "node:buffer";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { Effect, Either, Schema } from "effect";
import { parseWorkspaceJson } from "@recall/domain";
import type { Workspace } from "@recall/domain";
import type { DatabaseSync } from "node:sqlite";

const WorkspaceWriteLimit = 5_000_000;
const WorkspaceUpsertSql = `INSERT INTO local_workspace (id, serialized_workspace, updated_at)
VALUES (1, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  serialized_workspace = excluded.serialized_workspace,
  updated_at = excluded.updated_at`;

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
  ipcMain.handle("workspace:read", (event): DesktopReply<string | null> => {
    if (!trustedSender(event)) return failure();
    const result = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => {
            const row: unknown = database
              .prepare("SELECT serialized_workspace FROM local_workspace WHERE id = 1")
              .get();
            if (
              typeof row === "object" &&
              row !== null &&
              "serialized_workspace" in row &&
              typeof row.serialized_workspace === "string"
            ) {
              return row.serialized_workspace;
            }
            return null;
          },
          catch: () => ({ _tag: "WorkspaceReadFailure" }) as const,
        }),
      ),
    );
    return Either.isRight(result) ? { _tag: "Success", value: result.right } : failure();
  });

  ipcMain.handle("workspace:write", async (event, input: unknown): Promise<DesktopReply<void>> => {
    if (!trustedSender(event)) return failure();
    const serialized = Schema.decodeUnknownEither(Schema.String)(input);
    if (
      Either.isLeft(serialized) ||
      Buffer.byteLength(serialized.right, "utf8") > WorkspaceWriteLimit
    ) {
      return failure();
    }
    const decoded = await Effect.runPromise(Effect.either(parseWorkspaceJson(serialized.right)));
    if (Either.isLeft(decoded)) return failure();
    const write = Effect.try({
      try: () => {
        database
          .prepare(WorkspaceUpsertSql)
          .run(JSON.stringify(decoded.right satisfies Workspace), new Date().toISOString());
      },
      catch: () => ({ _tag: "WorkspaceWriteFailure" }) as const,
    });
    return Either.isRight(Effect.runSync(Effect.either(write)))
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
            database.prepare("DELETE FROM local_workspace WHERE id = 1").run();
          },
          catch: () => ({ _tag: "WorkspaceClearFailure" }) as const,
        }),
      ),
    );
    return Either.isRight(result) ? { _tag: "Success", value: undefined } : failure();
  });
}
