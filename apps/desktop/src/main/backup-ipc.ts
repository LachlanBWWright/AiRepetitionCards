import { readFile, stat, writeFile } from "node:fs/promises";
import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from "electron";
import { Effect, Either, Schema } from "effect";

const maxBackupBytes = 100_000_000;
type Reply<T> = { readonly _tag: "Success"; readonly value: T } | { readonly _tag: "Failure" };
type OpenedBackup = { readonly name: string; readonly bytes: Uint8Array };

function failure<T>(): Reply<T> {
  return { _tag: "Failure" };
}

export function registerBackupIpc(
  getWindow: () => BrowserWindow | null,
  trustedSender: (event: IpcMainInvokeEvent) => boolean,
): void {
  ipcMain.handle("backup:save", async (event, input: unknown): Promise<Reply<boolean>> => {
    if (!trustedSender(event)) return failure();
    const bytes = Schema.decodeUnknownEither(Schema.Uint8ArrayFromSelf)(input);
    if (Either.isLeft(bytes) || bytes.right.byteLength > maxBackupBytes) return failure();
    const options = {
      defaultPath: "recall-workspace-backup.zip",
      filters: [{ name: "Recall workspace backup", extensions: ["zip"] }],
    };
    const window = getWindow();
    const selected = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (selected.canceled || !selected.filePath) return { _tag: "Success", value: false };
    const saved = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => writeFile(selected.filePath, bytes.right),
          catch: () => "BackupWriteFailure" as const,
        }),
      ),
    );
    return Either.isRight(saved) ? { _tag: "Success", value: true } : failure();
  });

  ipcMain.handle("backup:open", async (event): Promise<Reply<OpenedBackup | null>> => {
    if (!trustedSender(event)) return failure();
    const options: OpenDialogOptions = {
      properties: ["openFile"],
      filters: [
        { name: "Recall workspace backups", extensions: ["zip", "json"] },
        { name: "All files", extensions: ["*"] },
      ],
    };
    const window = getWindow();
    const selected = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const filePath = selected.filePaths[0];
    if (selected.canceled || !filePath) return { _tag: "Success", value: null };
    const loaded = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: async (): Promise<OpenedBackup | null> => {
            const fileInfo = await stat(filePath);
            if (!fileInfo.isFile() || fileInfo.size > maxBackupBytes) return null;
            const bytes = new Uint8Array(await readFile(filePath));
            if (bytes.byteLength > maxBackupBytes) return null;
            return {
              name: filePath.split(/[\\/]/).at(-1) ?? "backup",
              bytes,
            };
          },
          catch: () => "BackupReadFailure" as const,
        }),
      ),
    );
    return Either.isRight(loaded) ? { _tag: "Success", value: loaded.right } : failure();
  });
}
