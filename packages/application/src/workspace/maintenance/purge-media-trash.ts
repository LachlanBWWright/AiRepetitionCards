import { Effect, Schema } from "effect";
import {
  parseWorkspaceJson,
  WorkspaceSchema,
  type MediaReference,
  type Workspace,
} from "@recall/domain";
import type { WorkspaceStore } from "@recall/local-store";
import { workspaceMediaReferences } from "../media/media-references";
export type MediaTrashPurgeResult = {
  readonly workspace: Workspace;
  readonly removed: number;
  readonly removedIds: readonly string[];
};
/** A paired write lane is mandatory: read the latest workspace and recheck drafts inside it. */
export function purgeMediaTrash(
  store: WorkspaceStore,
  protectedReferences: () => readonly MediaReference[],
): Effect.Effect<MediaTrashPurgeResult, { readonly message: string }> {
  const failure = { message: "Trash could not be emptied. Check storage and try again." };
  if (!store.coordinateMediaCommit)
    return Effect.fail({ message: "Safe cleanup is unavailable on this device." });
  const coordinate = store.coordinateMediaCommit;
  return Effect.suspend(() => {
    let result: MediaTrashPurgeResult | undefined;
    return coordinate((raw, media) =>
      Effect.gen(function* () {
        const rawText = yield* raw.read;
        if (!rawText)
          return yield* Effect.fail({
            _tag: "WorkspaceMediaCommitFailure",
            reason: "workspace-write",
          } as const);
        const parsed = yield* parseWorkspaceJson(rawText).pipe(
          Effect.mapError(
            () => ({ _tag: "WorkspaceMediaCommitFailure", reason: "workspace-write" }) as const,
          ),
        );
        const workspace = yield* Schema.decodeUnknown(WorkspaceSchema)(parsed).pipe(
          Effect.mapError(
            () => ({ _tag: "WorkspaceMediaCommitFailure", reason: "workspace-write" }) as const,
          ),
        );
        const protectedIds = new Set(
          [...workspaceMediaReferences(workspace), ...protectedReferences()].map(
            (entry) => entry.id,
          ),
        );
        const checkpoints = yield* raw.checkpoints?.read ?? Effect.succeed([]);
        for (const checkpoint of checkpoints) {
          const decoded = yield* Effect.either(parseWorkspaceJson(checkpoint.serializedWorkspace));
          if (decoded._tag === "Left")
            return yield* Effect.fail({
              _tag: "WorkspaceMediaCommitFailure",
              reason: "workspace-write",
            } as const);
          const value = yield* Schema.decodeUnknown(WorkspaceSchema)(decoded.right).pipe(
            Effect.mapError(
              () => ({ _tag: "WorkspaceMediaCommitFailure", reason: "workspace-write" }) as const,
            ),
          );
          for (const reference of workspaceMediaReferences(value)) protectedIds.add(reference.id);
        }
        const remove = (workspace.mediaTrash ?? []).filter(
          (entry) => !protectedIds.has(entry.reference.id),
        );
        const removed = new Set<string>();
        for (const entry of remove) {
          if (protectedReferences().some((reference) => reference.id === entry.reference.id))
            continue;
          yield* media
            .delete(entry.reference.id)
            .pipe(
              Effect.mapError(
                () => ({ _tag: "WorkspaceMediaCommitFailure", reason: "media-write" }) as const,
              ),
            );
          removed.add(entry.reference.id);
        }
        const next = {
          ...workspace,
          mediaTrash: workspace.mediaTrash?.filter((entry) => !removed.has(entry.reference.id)),
        };
        yield* raw.write(JSON.stringify(next));
        result = { workspace: next, removed: removed.size, removedIds: [...removed] };
      }).pipe(
        Effect.mapError(
          () => ({ _tag: "WorkspaceMediaCommitFailure", reason: "workspace-write" }) as const,
        ),
      ),
    ).pipe(
      Effect.mapError(() => failure),
      Effect.flatMap(() => (result ? Effect.succeed(result) : Effect.fail(failure))),
    );
  });
}

/** Apply only deleted trash identifiers to the latest in-memory workspace. */
export function applyMediaTrashPurge(
  workspace: Workspace,
  result: MediaTrashPurgeResult,
): Workspace {
  if (
    !result.removedIds.length ||
    (workspace.syncOwnerId ?? null) !== (result.workspace.syncOwnerId ?? null)
  )
    return workspace;
  const removed = new Set(result.removedIds);
  return {
    ...workspace,
    mediaTrash: workspace.mediaTrash?.filter((entry) => !removed.has(entry.reference.id)),
  };
}
