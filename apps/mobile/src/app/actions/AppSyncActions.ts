import { Effect, Either, Schema } from "effect";
import * as Crypto from "expo-crypto";
import {
  applyWorkspaceSyncChanges,
  bindWorkspaceOwner,
  applyWorkspaceContentConflict,
} from "@recall/application";
import { supabaseAuthClient } from "../../storage/auth/supabase-auth";
import { syncNativeWorkspace } from "../../storage/workspace/native-workspace-sync";
import type { NativeSyncBinding } from "../../storage/workspace/native-workspace-sync";
import { makeNativeWorkspaceMediaGateway } from "../../storage/media/native-workspace-media-gateway";
import type { AppCoreState } from "../useAppController";
import type { createAppWorkspaceActions } from "./AppWorkspaceActions";
function checkpointBoundWorkspace(
  current: Parameters<typeof bindWorkspaceOwner>[0],
  ownerId: Parameters<typeof bindWorkspaceOwner>[1],
  adoptLegacyOwner: boolean,
  isCurrent: () => boolean,
) {
  if (!isCurrent())
    return Effect.fail({
      _tag: "WorkspaceSyncFailure",
      reason: "account-changed",
    } as const);
  return bindWorkspaceOwner(current, ownerId, adoptLegacyOwner);
}
function createOwnerCheckpoint(
  commitWorkspaceChange: ReturnType<typeof createAppWorkspaceActions>["commitWorkspaceChange"],
  generation: number,
  isCurrent: () => boolean,
  adoptLegacyOwner: boolean,
): NativeSyncBinding["checkpoint"] {
  return (bound) =>
    commitWorkspaceChange(
      (current) =>
        checkpointBoundWorkspace(current, bound.syncOwnerId, adoptLegacyOwner, isCurrent),
      generation,
      { persistFirst: true, retainBindingOnAuthChange: true, isCurrent },
    ).pipe(Effect.mapError(() => ({ _tag: "WorkspaceSyncCheckpointFailure" }) as const));
}
export function createAppSyncActions(
  model: Pick<
    AppCoreState & ReturnType<typeof createAppWorkspaceActions>,
    | "workspaceLifetime"
    | "authSession"
    | "workspace"
    | "mediaStore"
    | "workspaceRef"
    | "commitWorkspaceChange"
    | "setSyncOwnershipIssue"
    | "syncConflictGeneration"
    | "syncConflictAuthGeneration"
    | "setSyncConflictWorkspace"
    | "setCacheWritable"
    | "syncConflictWorkspace"
    | "setActiveAreaId"
  >,
) {
  const {
    workspaceLifetime,
    authSession,
    workspace,
    mediaStore,
    workspaceRef,
    commitWorkspaceChange,
    setSyncOwnershipIssue,
    syncConflictGeneration,
    syncConflictAuthGeneration,
    setSyncConflictWorkspace,
    setCacheWritable,
    syncConflictWorkspace,
    setActiveAreaId,
  } = model;
  async function syncCloudWorkspace(
    adoptLegacyOwner = false,
    onProgress?: (workspace: NonNullable<typeof model.workspace>, more: boolean) => void,
  ): Promise<string> {
    const generation = workspaceLifetime.generation();
    const authGeneration = authSession.current.generation;
    if (workspaceLifetime.isBlocked())
      return "Local cleanup is pending. Finish resetting this device before syncing.";
    const authClient = supabaseAuthClient;
    if (!workspace || !authClient) return "Sign in and configure the Recall API before syncing.";
    if (!mediaStore) return "Local media storage is not ready yet. Try syncing again shortly.";
    const sessionResult = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => authClient.auth.getSession(),
          catch: () => ({ _tag: "SessionReadError" }) as const,
        }),
      ),
    );
    if (Either.isLeft(sessionResult)) return "Your sign-in session could not be read.";
    const session = sessionResult.right.data.session;
    const token = session?.access_token;
    const canonicalId = Schema.decodeUnknownEither(Schema.UUID)(session?.user.id);
    if (!token || Either.isLeft(canonicalId)) return "Sign in again before syncing.";
    const ownerId = canonicalId.right.toLowerCase();
    const isCurrent = () =>
      authSession.current.generation === authGeneration &&
      authSession.current.userId === ownerId &&
      authSession.current.token === token &&
      workspaceLifetime.generation() === generation &&
      !workspaceLifetime.isBlocked();
    if (!isCurrent()) return "Your account session changed. Sync again with the current account.";
    const baseline = workspaceRef.current;
    if (!baseline) return "The local workspace is unavailable.";
    const synced = await Effect.runPromise(
      Effect.either(
        syncNativeWorkspace(
          baseline,
          token,
          () => Crypto.randomUUID(),
          mediaStore,
          (remoteOwnerId) =>
            makeNativeWorkspaceMediaGateway(
              process.env.EXPO_PUBLIC_RECALL_API_URL ?? "",
              () => Promise.resolve(isCurrent() ? token : null),
              remoteOwnerId,
              isCurrent,
            ),
          {
            expectedOwnerId: ownerId,
            adoptLegacyOwner,
            isCurrent,
            checkpoint: createOwnerCheckpoint(
              commitWorkspaceChange,
              generation,
              isCurrent,
              adoptLegacyOwner,
            ),
          },
        ),
      ),
    );
    if (workspaceLifetime.generation() !== generation || workspaceLifetime.isBlocked())
      return "This sync was discarded because the local workspace was reset or deleted.";
    if (!isCurrent())
      return "This sync was discarded because your account session changed. Offline data remains available.";
    if (Either.isLeft(synced)) {
      const reason = synced.left.reason;
      if (reason === "account-mismatch" || reason === "owner-adoption-required") {
        setSyncOwnershipIssue(reason);
        return reason === "account-mismatch"
          ? "This workspace belongs to another account. Keep it offline or export a backup before resetting for this account."
          : "This legacy workspace has cloud sync history but no recorded account owner. Confirm its account before syncing.";
      }
      if (reason === "ownership-checkpoint")
        return "Workspace account ownership could not be saved. No sync uploads were started; your offline data remains available.";
      if (reason === "deleted-review-content-missing")
        return "A pending review refers to deleted content that this older workspace no longer contains. Export this device's current private backup or review snapshot before replacing it with an older backup containing that card. Your reviews remain saved; backups are not automatically merged.";
      if (reason === "deleted-review-provision-capacity")
        return "Cloud content and pending deleted-review content exceed this area's card or objective limits. Local cards and reviews remain saved. Export a private backup before changing cloud content to free capacity.";
      return "Sync failed. Your current offline data remains available.";
    }
    setSyncOwnershipIssue(null);
    if (synced.right._tag === "ContentConflict") {
      syncConflictGeneration.current = generation;
      syncConflictAuthGeneration.current = authGeneration;
      setSyncConflictWorkspace(synced.right.workspace);
      return "A server content change needs your review. Compare the area list below before loading it.";
    }
    const result = synced.right;
    const committed = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange(
          (current) => applyWorkspaceSyncChanges(current, result, () => Crypto.randomUUID()),
          generation,
          { isCurrent },
        ),
      ),
    );
    if (Either.isLeft(committed)) {
      if (committed.left._tag === "NativeWorkspacePersistenceFailed") {
        setCacheWritable(false);
        return "Sync progress could not be saved locally. The received changes remain in this session.";
      }
      return "Sync could not reconcile the latest local workspace. Your current data was preserved.";
    }
    onProgress?.(
      committed.right,
      result.hasMore ||
        result.uploadDeferred ||
        (committed.right.pendingReviewEventIds?.length ?? 0) > 0 ||
        (committed.right.syncPendingContentAreaIds?.length ?? 0) > 0 ||
        (committed.right.syncContentConflictAreaIds?.length ?? 0) > 0,
    );
    setSyncConflictWorkspace(null);
    if ((committed.right.syncContentConflictAreaIds ?? []).length > 0)
      return "Your newer local edits were preserved. Sync again to review conflicting server content.";
    if (
      (committed.right.syncPendingContentAreaIds ?? []).length > 0 &&
      !synced.right.hasMore &&
      !synced.right.uploadDeferred
    )
      return "Your newer local edits were preserved. Sync again to upload them.";
    if (synced.right.hasMore)
      return "Sync progress saved. More remote changes remain; sync again to continue.";
    if (synced.right.uploadDeferred)
      return (committed.right.retainedReviewAreas ?? []).length > 0
        ? "Reviews and deletion acknowledgements are still syncing. Deleted content stays hidden; sync again to finish."
        : "Sync progress received. Sync again to finish content and local uploads.";
    const remainingPendingReviews = committed.right.pendingReviewEventIds?.length ?? 0;
    if (remainingPendingReviews > 0)
      return `Sync progress saved. ${String(remainingPendingReviews)} pending review${remainingPendingReviews === 1 ? " remains" : "s remain"}; sync again to continue.`;
    return "Your decks and reviews are synced.";
  }
  async function useServerWorkspace(): Promise<string> {
    if (!syncConflictWorkspace) return "There is no server version awaiting review.";
    const preview = syncConflictWorkspace;
    const ownerId = preview.syncOwnerId;
    const generation = syncConflictGeneration.current;
    if (
      generation === null ||
      generation !== workspaceLifetime.generation() ||
      syncConflictAuthGeneration.current !== authSession.current.generation ||
      !ownerId ||
      preview.syncOwnerId !== authSession.current.userId ||
      workspaceLifetime.isBlocked()
    )
      return "This server preview belongs to a workspace that was reset or deleted. Sync again.";
    const committed = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange(
          (current) =>
            applyWorkspaceContentConflict(current, {
              ownerId,
              areas: preview.areas,
              hashes: preview.syncContentHashes ?? {},
              deletedAreaIds: (preview.deletedAreas ?? [])
                .filter((item) => item.synced)
                .map((item) => item.areaId),
            }),
          generation,
          {
            isCurrent: () =>
              syncConflictAuthGeneration.current === authSession.current.generation &&
              preview.syncOwnerId === authSession.current.userId,
          },
        ),
      ),
    );
    if (Either.isLeft(committed)) {
      if (committed.left._tag === "NativeWorkspacePersistenceFailed") setCacheWritable(false);
      return "Server content could not be saved. Your review history remains in this session.";
    }
    setActiveAreaId(committed.right.areas[0]?.id ?? null);
    setSyncConflictWorkspace(null);
    return "Server content loaded. Pending reviews will upload automatically.";
  }
  return { syncCloudWorkspace, useServerWorkspace } as const;
}
