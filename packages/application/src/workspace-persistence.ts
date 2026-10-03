import { Effect, Either } from "effect";
import { parseWorkspaceJson, type Workspace } from "@recall/domain";
import type { WorkspaceStore } from "@recall/local-store";

export type WorkspaceLoadResult =
  | { readonly _tag: "Empty" }
  | { readonly _tag: "Loaded"; readonly workspace: Workspace }
  | {
      readonly _tag: "Invalid";
      readonly reason: "invalid-json" | "invalid-shape" | "unsupported-version";
    };

export type WorkspacePersistenceFailure =
  | { readonly _tag: "LocalStoreFailure"; readonly operation: "read" | "write" | "clear" }
  | { readonly _tag: "WorkspaceSerializationFailure" };

export function loadWorkspace(
  store: WorkspaceStore,
): Effect.Effect<WorkspaceLoadResult, WorkspacePersistenceFailure> {
  return Effect.gen(function* () {
    const raw = yield* store.read;
    if (raw === null) return { _tag: "Empty" } as const;
    const decoded = yield* Effect.either(parseWorkspaceJson(raw));
    if (Either.isLeft(decoded)) {
      return { _tag: "Invalid", reason: decoded.left.reason } as const;
    }
    const reviewEvents = decoded.right.reviewEvents ?? [];
    return {
      _tag: "Loaded",
      workspace: {
        ...decoded.right,
        reviewEvents,
        reviews: reviewEvents.length || decoded.right.reviews,
      },
    } as const;
  });
}

export function saveWorkspace(
  store: WorkspaceStore,
  workspace: Workspace,
): Effect.Effect<void, WorkspacePersistenceFailure> {
  return Effect.gen(function* () {
    const serialized = yield* Effect.try({
      try: () => JSON.stringify(workspace),
      catch: () => ({ _tag: "WorkspaceSerializationFailure" }) as const,
    });
    yield* store.write(serialized);
  });
}

export function clearWorkspace(
  store: WorkspaceStore,
): Effect.Effect<void, WorkspacePersistenceFailure> {
  return store.clear;
}
