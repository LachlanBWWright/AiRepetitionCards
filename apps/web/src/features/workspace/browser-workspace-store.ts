import { Effect } from "effect";
import type { LocalStoreFailure, WorkspaceStore } from "@recall/local-store";
import { WORKSPACE_STORAGE_KEY } from "@/features/workspace/types";

function storageFailure(operation: LocalStoreFailure["operation"]): LocalStoreFailure {
  return { _tag: "LocalStoreFailure", operation };
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

export const browserWorkspaceStore: WorkspaceStore = {
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
      : Effect.try({
          try: () => window.localStorage.getItem(WORKSPACE_STORAGE_KEY),
          catch: () => storageFailure("read"),
        });
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
        : Effect.try({
            try: () => window.localStorage.setItem(WORKSPACE_STORAGE_KEY, serializedWorkspace),
            catch: () => storageFailure("write"),
          });
    }),
  clear: Effect.suspend(() => {
    const desktopWorkspace = window.recallDesktop?.workspace;
    return desktopWorkspace
      ? Effect.tryPromise({
          try: async () => desktopCommand(await desktopWorkspace.clear(), "clear"),
          catch: () => storageFailure("clear"),
        }).pipe(Effect.flatten)
      : Effect.try({
          try: () => window.localStorage.removeItem(WORKSPACE_STORAGE_KEY),
          catch: () => storageFailure("clear"),
        });
  }),
};
