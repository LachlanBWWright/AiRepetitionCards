import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { Effect, Either } from "effect";
import { readAnkiSqliteInDesktop } from "./anki-sqlite-reader";

type Reply<T> = { readonly _tag: "Success"; readonly value: T } | { readonly _tag: "Failure" };

const maxDatabaseBytes = 80_000_000;

/** Exposes only a bounded legacy Anki database read to the trusted renderer. */
export function registerDesktopAnkiIpc(isTrusted: (event: IpcMainInvokeEvent) => boolean): void {
  ipcMain.handle("anki:read-sqlite", async (event, input: unknown): Promise<Reply<unknown>> => {
    if (
      !isTrusted(event) ||
      !(input instanceof Uint8Array) ||
      input.byteLength > maxDatabaseBytes
    ) {
      return { _tag: "Failure" };
    }
    const result = await Effect.runPromise(Effect.either(readAnkiSqliteInDesktop(input)));
    return Either.isRight(result) ? { _tag: "Success", value: result.right } : { _tag: "Failure" };
  });
}
