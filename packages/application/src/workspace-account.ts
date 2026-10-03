import { Effect, Either, Schema } from "effect";
import { AccountIdSchema, type Workspace } from "@recall/domain";
import type { WorkspaceSyncFailure } from "./workspace-sync";

export function workspaceHasRemoteSyncMetadata(workspace: Workspace): boolean {
  const pending =
    workspace.pendingReviewEventIds === undefined ? null : new Set(workspace.pendingReviewEventIds);
  const acceptedHistory =
    pending !== null &&
    (workspace.reviewEvents ?? []).some(
      (event) =>
        event.deviceId !== undefined &&
        event.deviceSequence !== undefined &&
        !pending.has(event.id),
    );
  return (
    (workspace.syncCursor !== undefined && /[1-9]/.test(workspace.syncCursor)) ||
    workspace.syncHasMore === true ||
    Object.keys(workspace.syncContentHashes ?? {}).length > 0 ||
    (workspace.deletedAreas ?? []).some((area) => area.synced === true) ||
    (workspace.syncContentConflictAreaIds ?? []).length > 0 ||
    (workspace.reviewConflictIds ?? []).length > 0 ||
    acceptedHistory
  );
}
/** Binding never changes content identities or transfers a different owner's workspace. */
export function bindWorkspaceOwner(
  workspace: Workspace,
  ownerId: unknown,
  adoptLegacyOwner = false,
): Effect.Effect<Workspace, WorkspaceSyncFailure> {
  const decoded = Schema.decodeUnknownEither(AccountIdSchema)(ownerId);
  if (Either.isLeft(decoded))
    return Effect.fail({ _tag: "WorkspaceSyncFailure", reason: "account-changed" });
  const owner = decoded.right;
  if (workspace.syncOwnerId && workspace.syncOwnerId.toLowerCase() !== owner)
    return Effect.fail({ _tag: "WorkspaceSyncFailure", reason: "account-mismatch" });
  if (!workspace.syncOwnerId && workspaceHasRemoteSyncMetadata(workspace) && !adoptLegacyOwner)
    return Effect.fail({ _tag: "WorkspaceSyncFailure", reason: "owner-adoption-required" });
  return Effect.succeed(
    workspace.syncOwnerId === owner ? workspace : { ...workspace, syncOwnerId: owner },
  );
}
export function workspaceAccountFailureMessage(failure: WorkspaceSyncFailure): string {
  switch (failure.reason) {
    case "deleted-review-content-missing":
      return "Some pending reviews refer to deleted content that this device no longer has. Export your current private backup first to preserve all current content and review history before replacing this workspace with an older backup containing those cards. Backups are not merged automatically. You can continue offline.";
    case "deleted-review-provision-capacity":
      return "Deleted cards still needed by pending reviews exceed the sync provisioning limit. Your current content and review history remain on this device. Export a current private backup before making recovery changes; you can continue offline.";
    case "account-mismatch":
      return "This offline workspace belongs to another account. Keep studying offline or export it before clearing this device and starting a separate workspace. Its content and reviews were not uploaded.";
    case "owner-adoption-required":
      return "This workspace has earlier sync data without a saved account identity. Confirm that it belongs to the signed-in account before syncing, or keep it offline and export it.";
    case "ownership-checkpoint":
      return "The account binding could not be saved locally. No content or reviews were uploaded. Restore local storage before retrying.";
    case "account-changed":
      return "The signed-in account changed during sync. The old result was discarded; your offline data remains available.";
    default:
      return "Sync could not finish. Your offline data remains available.";
  }
}
