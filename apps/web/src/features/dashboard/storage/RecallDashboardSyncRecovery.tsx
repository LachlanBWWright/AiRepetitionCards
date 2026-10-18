import { Effect, Either } from "effect";
import type { ComponentProps } from "react";
import {
  applyWorkspaceSyncChanges,
  bindWorkspaceOwner,
  workspaceHasRemoteSyncMetadata,
  type WorkspaceSyncCheckpointFailure,
  applyWorkspaceContentConflict,
  saveWorkspace,
} from "@recall/application";
import { WorkspaceSyncAction } from "@/components/auth/WorkspaceSyncAction";
import { browserWorkspaceStore } from "@/features/workspace/browser-workspace-store";
import { localWritesBlocked } from "@/features/workspace/local-write-coordinator";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";

type SyncHandler = NonNullable<ComponentProps<typeof WorkspaceSyncAction>["onSynced"]>;

export function RecallDashboardSyncRecovery({ model }: { readonly model: RecallDashboardModel }) {
  const {
    workspaceUnlocked,
    demo,
    setMissingDeletedReviewContent,
    setDeletedReviewProvisionCapacity,
    exportWorkspaceBackup,
    discardSavedWorkspace,
    enqueueWorkspaceSave,
    ready,
    cacheWritable,
    workspaceRef,
    setWorkspace,
    workspace,
    setImportNotice,
    setCloudWorkspaceLoaded,
    reviewingRef,
    pendingReviewRef,
  } = model;
  async function persistCheckpoint(candidate: typeof workspace) {
    return enqueueWorkspaceSave(async () => {
      for (;;) {
        if (!ready || !cacheWritable || localWritesBlocked())
          return Either.left({ _tag: "WorkspaceSyncCheckpointFailure" } as const);
        const current = workspaceRef.current;
        const bound = await Effect.runPromise(
          Effect.either(
            bindWorkspaceOwner(
              current,
              candidate.syncOwnerId,
              workspaceHasRemoteSyncMetadata(candidate),
            ),
          ),
        );
        if (Either.isLeft(bound))
          return Either.left({ _tag: "WorkspaceSyncCheckpointFailure" } as const);
        const persisted = await Effect.runPromise(
          Effect.either(saveWorkspace(browserWorkspaceStore, bound.right)),
        );
        if (Either.isLeft(persisted) || localWritesBlocked())
          return Either.left({ _tag: "WorkspaceSyncCheckpointFailure" } as const);
        if (workspaceRef.current !== current) continue;
        setWorkspace(bound.right);
        return Either.right(bound.right);
      }
    });
  }
  function checkpoint(candidate: typeof workspace) {
    return Effect.tryPromise({
      try: () => persistCheckpoint(candidate),
      catch: (): WorkspaceSyncCheckpointFailure => ({
        _tag: "WorkspaceSyncCheckpointFailure",
      }),
    }).pipe(Effect.flatMap((result) => result));
  }
  const handleSynced: SyncHandler = (
    acceptedIds,
    cursor,
    pulledEvents,
    pulledAreas,
    deletedCardIds,
    syncedAreaTombstoneIds,
    pulledDeletedAreaIds,
    contentHashes,
    conflicts,
    hasMore,
    uploadDeferred,
    baseline,
  ) => {
    if (localWritesBlocked()) return null;
    const applied = Effect.runSync(
      Effect.either(
        applyWorkspaceSyncChanges(
          workspaceRef.current,
          {
            baseline,
            acceptedIds,
            cursor,
            pulledEvents,
            pulledAreas,
            deletedCardIds,
            syncedAreaTombstoneIds,
            pulledDeletedAreaIds,
            contentHashes,
            conflicts,
            hasMore,
            uploadDeferred,
          },
          () => crypto.randomUUID(),
        ),
      ),
    );
    if (Either.isLeft(applied)) {
      setImportNotice(
        "Synced changes could not be reconciled. Your latest tab workspace was preserved.",
      );
      return null;
    }
    setCloudWorkspaceLoaded(true);
    setWorkspace(applied.right);
    setMissingDeletedReviewContent(false);
    setDeletedReviewProvisionCapacity(false);
    return applied.right;
  };
  return (
    <div hidden={!workspaceUnlocked}>
      <WorkspaceSyncAction
        autoSync={!demo}
        demo={Boolean(demo)}
        demoMissingReviewContent={demo?.missingReviewContent ?? false}
        onMissingReviewContent={() => {
          setMissingDeletedReviewContent(true);
          setDeletedReviewProvisionCapacity(false);
        }}
        onReviewProvisionCapacity={() => {
          setDeletedReviewProvisionCapacity(true);
          setMissingDeletedReviewContent(false);
        }}
        {...(demo?.syncAccountState ? { demoAccountState: demo.syncAccountState } : {})}
        onExportOffline={() => void exportWorkspaceBackup()}
        onClearWorkspace={() => void discardSavedWorkspace()}
        checkpoint={checkpoint}
        workspace={workspace}
        onSynced={handleSynced}
        onContentConflict={(ownerId, remoteAreas, contentHashes, deletedAreaIds) => {
          if (reviewingRef.current || pendingReviewRef.current) return false;
          const preview = {
            ownerId,
            areas: remoteAreas,
            hashes: contentHashes,
            deletedAreaIds,
          };
          const preflight = Effect.runSync(
            Effect.either(applyWorkspaceContentConflict(workspace, preview)),
          );
          if (Either.isLeft(preflight)) return false;
          setWorkspace((current) => {
            if (current === workspace) return preflight.right;
            const applied = Effect.runSync(
              Effect.either(applyWorkspaceContentConflict(current, preview)),
            );
            return Either.isRight(applied) ? applied.right : current;
          });
          return true;
        }}
      />
    </div>
  );
}
