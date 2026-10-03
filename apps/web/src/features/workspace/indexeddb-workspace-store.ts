import { Effect, Either } from "effect";
import { parseWorkspaceJson, type Workspace } from "@recall/domain";
import type { LocalStoreFailure, WorkspaceStore } from "@recall/local-store";
import { WORKSPACE_STORAGE_KEY } from "./types";
import { markLocalSnapshotStale } from "./local-snapshot-status";

const databaseName = "recall-workspace";
const objectStoreName = "snapshots";
const snapshotKey = "current";
type Operation = LocalStoreFailure["operation"];
type Result =
  | { readonly _tag: "Success"; readonly value: string | null }
  | { readonly _tag: "Failure"; readonly reason?: "stale-snapshot" };
const failed: Result = { _tag: "Failure" };
let baselineLoaded = false;
let baseline: string | null = null;

function validWorkspace(raw: string): boolean {
  return Either.isRight(Effect.runSync(Effect.either(parseWorkspaceJson(raw))));
}

/** A stale tab or backup cannot erase an ownership checkpoint already committed by another tab. */
function canReplaceWorkspace(current: string | null | undefined, replacement: string): boolean {
  const next = Effect.runSync(Effect.either(parseWorkspaceJson(replacement)));
  if (Either.isLeft(next)) return false;
  if (typeof current !== "string") return true;
  const previous = Effect.runSync(Effect.either(parseWorkspaceJson(current)));
  if (Either.isLeft(previous)) return false;
  const previousWorkspace: Workspace = previous.right;
  const nextWorkspace: Workspace = next.right;
  return (
    previousWorkspace.syncOwnerId === undefined ||
    previousWorkspace.syncOwnerId === nextWorkspace.syncOwnerId
  );
}

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request = window.indexedDB.open(databaseName, 1);
    let unavailable = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore(objectStoreName);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => {
      unavailable = true;
      resolve(null);
    };
    request.onsuccess = () => {
      if (unavailable) request.result.close();
      else {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      }
    };
  });
}

/** Read and conditionally replace in one transaction, including legacy migration. */
function transact(
  database: IDBDatabase,
  operation: Operation,
  replacement?: string,
): Promise<Result> {
  return new Promise((resolve) => {
    const transaction = database.transaction(objectStoreName, "readwrite");
    const store = transaction.objectStore(objectStoreName);
    const request: IDBRequest<unknown> = store.get(snapshotKey);
    let result: Result = failed;
    let migratedLegacy: string | null = null;
    let committedSnapshot: string | null = null;
    transaction.onerror = () => resolve(failed);
    transaction.onabort = () => resolve(failed);
    transaction.oncomplete = () => {
      if (result._tag === "Success" && (migratedLegacy !== null || operation === "clear")) {
        // Only remove the legacy value after a durable commit. Do not remove a
        // value another tab changed while this transaction was running.
        const cleanup = Effect.runSync(
          Effect.either(
            Effect.try({
              try: () => {
                if (
                  operation === "clear" ||
                  window.localStorage.getItem(WORKSPACE_STORAGE_KEY) === migratedLegacy
                )
                  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
              },
              catch: () => failed,
            }),
          ),
        );
        if (operation === "clear" && Either.isLeft(cleanup)) result = failed;
      }
      if (result._tag === "Success") {
        baseline = committedSnapshot;
        baselineLoaded = true;
      }
      resolve(result);
    };
    request.onsuccess = () => {
      const handled = Effect.runSync(
        Effect.either(
          Effect.try({
            try: () => {
              if (operation === "clear") {
                // A durable empty marker prevents an old localStorage value
                // from being resurrected if its removal is unavailable.
                store.put(null, snapshotKey);
                result = { _tag: "Success", value: null };
                return;
              }
              const persisted = request.result;
              if (persisted !== undefined && persisted !== null && typeof persisted !== "string")
                return;
              const legacy =
                persisted === undefined ? window.localStorage.getItem(WORKSPACE_STORAGE_KEY) : null;
              const current = persisted === undefined ? legacy : persisted;
              if (
                (baselineLoaded && current !== baseline) ||
                (operation === "write" && !baselineLoaded)
              ) {
                result = { _tag: "Failure", reason: "stale-snapshot" };
                markLocalSnapshotStale();
                return;
              }
              if (operation === "write") {
                if (replacement === undefined || !canReplaceWorkspace(current, replacement)) return;
                store.put(replacement, snapshotKey);
                migratedLegacy = legacy;
                result = { _tag: "Success", value: null };
                committedSnapshot = replacement;
                return;
              }
              result = { _tag: "Success", value: current };
              committedSnapshot = current;
              if (legacy !== null && validWorkspace(legacy)) {
                store.put(legacy, snapshotKey);
                migratedLegacy = legacy;
              }
            },
            catch: () => failed,
          }),
        ),
      );
      if (Either.isLeft(handled)) {
        result = failed;
        transaction.abort();
      }
    };
  });
}

function operation(kind: Operation, replacement?: string) {
  return Effect.tryPromise({
    try: async () => {
      const database = await openDatabase();
      if (database === null) return failed;
      try {
        return await transact(database, kind, replacement);
      } finally {
        database.close();
      }
    },
    catch: (): LocalStoreFailure => ({ _tag: "LocalStoreFailure", operation: kind }),
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === "Success"
        ? Effect.succeed(result.value)
        : Effect.fail({
            _tag: "LocalStoreFailure",
            operation: kind,
            ...(result.reason ? { reason: result.reason } : {}),
          } as const),
    ),
  );
}

export const indexedDbWorkspaceStore: WorkspaceStore = {
  read: operation("read"),
  write: (serialized) => operation("write", serialized).pipe(Effect.asVoid),
  clear: operation("clear").pipe(Effect.asVoid),
};
