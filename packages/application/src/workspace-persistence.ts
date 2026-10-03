import { Effect, Either } from "effect";
import { parseWorkspaceJson, type Workspace } from "@recall/domain";
import type {
  MediaStore,
  StoredMediaAsset,
  WorkspaceStore,
  WorkspaceMediaCommitFailure,
} from "@recall/local-store";
import { persistMediaAssets } from "./media-persistence";

export type WorkspaceLoadResult =
  | { readonly _tag: "Empty" }
  | { readonly _tag: "Loaded"; readonly workspace: Workspace }
  | {
      readonly _tag: "Invalid";
      readonly reason: "invalid-json" | "invalid-shape" | "unsupported-version";
    };

export type WorkspacePersistenceFailure =
  | {
      readonly _tag: "LocalStoreFailure";
      readonly operation: "read" | "write" | "clear";
      readonly reason?: "stale-snapshot";
    }
  | { readonly _tag: "WorkspaceSerializationFailure" };

export type { WorkspaceMediaCommitFailure } from "@recall/local-store";

export type WorkspaceMediaClearResult = {
  readonly workspaceCleared: boolean;
  readonly mediaCleared: boolean;
};

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

/** Use paired store coordination when available; otherwise retain assets on uncertain failure. */
export function saveWorkspaceWithMedia(
  workspaceStore: WorkspaceStore,
  mediaStore: MediaStore,
  workspace: Workspace,
  assets: readonly StoredMediaAsset[],
): Effect.Effect<void, WorkspaceMediaCommitFailure> {
  if (assets.length > 0 && workspaceStore.coordinateMediaCommit)
    return workspaceStore.coordinateMediaCommit((rawWorkspaceStore, rawMediaStore) =>
      commitWorkspaceWithMedia(rawWorkspaceStore, rawMediaStore, workspace, assets, true),
    );
  return commitWorkspaceWithMedia(workspaceStore, mediaStore, workspace, assets, false);
}

function commitWorkspaceWithMedia(
  workspaceStore: WorkspaceStore,
  mediaStore: MediaStore,
  workspace: Workspace,
  assets: readonly StoredMediaAsset[],
  rollbackSafe: boolean,
): Effect.Effect<void, WorkspaceMediaCommitFailure> {
  return Effect.gen(function* () {
    if (assets.length === 0)
      return yield* saveWorkspace(workspaceStore, workspace).pipe(
        Effect.mapError(
          () =>
            ({
              _tag: "WorkspaceMediaCommitFailure",
              reason: "workspace-write",
            }) as const,
        ),
      );
    const listed = yield* Effect.either(mediaStore.list);
    if (Either.isLeft(listed))
      return yield* Effect.fail({
        _tag: "WorkspaceMediaCommitFailure",
        reason: "media-list",
      } as const);

    const existing = new Set(listed.right.map((reference) => reference.id));
    const rollback = () =>
      rollbackSafe
        ? Effect.forEach(
            [...new Set(assets.map((asset) => asset.reference.id))].filter(
              (id) => !existing.has(id),
            ),
            (id) => Effect.either(mediaStore.delete(id)),
            { concurrency: 1 },
          )
        : Effect.succeed([]);
    const mediaSaved = yield* Effect.either(persistMediaAssets(mediaStore, assets));
    if (Either.isLeft(mediaSaved)) {
      const removed = yield* rollback();
      return yield* Effect.fail({
        _tag: "WorkspaceMediaCommitFailure",
        reason: removed.some(Either.isLeft) ? "media-rollback" : "media-write",
      } as const);
    }

    const workspaceSaved = yield* Effect.either(saveWorkspace(workspaceStore, workspace));
    if (Either.isRight(workspaceSaved)) return;

    const removed = yield* rollback();
    return yield* Effect.fail({
      _tag: "WorkspaceMediaCommitFailure",
      reason: removed.some(Either.isLeft) ? "media-rollback" : "workspace-write",
    } as const);
  });
}

export function clearWorkspace(
  store: WorkspaceStore,
): Effect.Effect<void, WorkspacePersistenceFailure> {
  return store.clear;
}

/** Attempt to remove the saved workspace and every local media asset. */
export function clearWorkspaceAndMedia(
  workspaceStore: WorkspaceStore,
  mediaStore: MediaStore,
): Effect.Effect<WorkspaceMediaClearResult> {
  return Effect.gen(function* () {
    const listed = yield* Effect.either(mediaStore.list);
    const deletions = Either.isRight(listed)
      ? yield* Effect.forEach(
          listed.right,
          (reference) => Effect.either(mediaStore.delete(reference.id)),
          {
            concurrency: 1,
          },
        )
      : [];
    const workspace = yield* Effect.either(workspaceStore.clear);
    return {
      workspaceCleared: Either.isRight(workspace),
      mediaCleared: Either.isRight(listed) && deletions.every(Either.isRight),
    } as const;
  });
}
