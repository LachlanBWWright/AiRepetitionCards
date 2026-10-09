import { Effect } from "effect";
import type { LocalStoreFailure, WorkspaceStore } from "@recall/local-store";
import { volatileWorkspaceStore } from "./volatile-workspace-store";
import { coordinateLocalWrite } from "./local-write-coordinator";
import { localSnapshotStale } from "./local-snapshot-status";
import { uncoordinatedMediaStore } from "./browser-media-store";

function storageFailure(operation: LocalStoreFailure["operation"]): LocalStoreFailure {
  return {
    _tag: "LocalStoreFailure",
    operation,
    ...(localSnapshotStale() && operation !== "clear" ? { reason: "stale-snapshot" as const } : {}),
  };
}

function desktopReplyValue<A>(
  reply: unknown,
  operation: LocalStoreFailure["operation"],
  validate: (value: unknown) => value is A,
): Effect.Effect<A, LocalStoreFailure> {
  if (
    typeof reply !== "object" ||
    reply === null ||
    !("_tag" in reply) ||
    reply._tag !== "Success"
  ) {
    return Effect.fail(storageFailure(operation));
  }
  if (!("value" in reply) || !validate(reply.value)) return Effect.fail(storageFailure(operation));
  return Effect.succeed(reply.value);
}

function desktopCommand(
  reply: unknown,
  operation: "write" | "clear",
): Effect.Effect<void, LocalStoreFailure> {
  return typeof reply === "object" && reply !== null && "_tag" in reply && reply._tag === "Success"
    ? Effect.void
    : Effect.fail(storageFailure(operation));
}

export const uncoordinatedWorkspaceStore: WorkspaceStore = {
  read: Effect.suspend(() => {
    const desktopWorkspace = window.recallDesktop?.workspace;
    return desktopWorkspace
      ? Effect.tryPromise({
          try: async () =>
            desktopReplyValue(
              await desktopWorkspace.read(),
              "read",
              (value): value is string | null => value === null || typeof value === "string",
            ),
          catch: () => storageFailure("read"),
        }).pipe(Effect.flatten)
      : volatileWorkspaceStore.read;
  }),
  write: (serializedWorkspace) =>
    Effect.suspend(() => {
      const desktopWorkspace = window.recallDesktop?.workspace;
      return desktopWorkspace
        ? Effect.tryPromise({
            try: async () =>
              desktopCommand(await desktopWorkspace.write(serializedWorkspace), "write"),
            catch: () => storageFailure("write"),
          }).pipe(Effect.flatten)
        : volatileWorkspaceStore.write(serializedWorkspace);
    }),
  clear: Effect.suspend(() => {
    const desktopWorkspace = window.recallDesktop?.workspace;
    return desktopWorkspace
      ? Effect.tryPromise({
          try: async () => desktopCommand(await desktopWorkspace.clear(), "clear"),
          catch: () => storageFailure("clear"),
        }).pipe(Effect.flatten)
      : volatileWorkspaceStore.clear;
  }),
};

export const browserWorkspaceStore: WorkspaceStore = {
  ...uncoordinatedWorkspaceStore,
  coordinateMediaCommit: (commit) =>
    coordinateLocalWrite(
      commit(uncoordinatedWorkspaceStore, uncoordinatedMediaStore),
      () => ({ _tag: "WorkspaceMediaCommitFailure", reason: "workspace-write" }) as const,
    ),
  read: coordinateLocalWrite(uncoordinatedWorkspaceStore.read, () => storageFailure("read")),
  write: (serializedWorkspace) =>
    coordinateLocalWrite(uncoordinatedWorkspaceStore.write(serializedWorkspace), () =>
      storageFailure("write"),
    ),
  clear: coordinateLocalWrite(uncoordinatedWorkspaceStore.clear, () => storageFailure("clear")),
};

/** Review commits alone can pass the pending-review barrier; all fences still apply. */
export const browserReviewWorkspaceStore: WorkspaceStore = {
  ...browserWorkspaceStore,
  write: (serializedWorkspace) =>
    coordinateLocalWrite(
      uncoordinatedWorkspaceStore.write(serializedWorkspace),
      () => storageFailure("write"),
      true,
    ),
};
