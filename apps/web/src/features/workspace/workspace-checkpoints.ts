import { Effect, Schema } from "effect";
import {
  WorkspaceCheckpointsSchema,
  type WorkspaceCheckpointStore,
  type WorkspaceCheckpoint,
} from "@recall/local-store";
let entries: readonly WorkspaceCheckpoint[] = [];
/** Browser checkpoints follow the tab-only working-copy policy; Electron stores them in SQLite. */
export const browserWorkspaceCheckpoints: WorkspaceCheckpointStore = {
  get durable() {
    return typeof window !== "undefined" && Boolean(window.recallDesktop);
  },
  read: Effect.suspend(() => {
    const desktop = window.recallDesktop;
    if (!desktop) return Effect.succeed(entries);
    return Effect.tryPromise({
      try: () => desktop.workspace.checkpoints(),
      catch: () => ({ _tag: "LocalStoreFailure", operation: "read" }) as const,
    }).pipe(
      Effect.flatMap((reply) => {
        if (
          typeof reply !== "object" ||
          reply === null ||
          !("_tag" in reply) ||
          reply._tag !== "Success" ||
          !("value" in reply)
        )
          return Effect.fail({ _tag: "LocalStoreFailure", operation: "read" } as const);
        return Schema.decodeUnknown(WorkspaceCheckpointsSchema)(reply.value).pipe(
          Effect.mapError(() => ({ _tag: "LocalStoreFailure", operation: "read" }) as const),
        );
      }),
    );
  }),
  write: (next) =>
    Effect.suspend(() =>
      window.recallDesktop
        ? Effect.fail({ _tag: "LocalStoreFailure", operation: "write" } as const)
        : Effect.sync(() => {
            entries = next;
          }),
    ),
};
