import { withNativeOperationStoreLane } from "../../storage/workspace/native-operation-store";
import { Effect, Either } from "effect";
import { supabaseAuthClient } from "../../storage/auth/supabase-auth";
import {
  deleteNativeAccount,
  exportNativeAccountData,
} from "../../storage/workspace/native-account-api";
import type { AppCoreState } from "../useAppController";
import type { createAppWorkspaceActions } from "./AppWorkspaceActions";
export function createAppAccountActions(
  model: Pick<
    AppCoreState & ReturnType<typeof createAppWorkspaceActions>,
    | "workspace"
    | "workspaceLifetime"
    | "captureCleanupTargets"
    | "invalidateWorkspaceOperations"
    | "syncConflictGeneration"
    | "setSyncConflictWorkspace"
    | "store"
    | "mediaStore"
    | "clearLocalStores"
    | "clearAuxiliaryNativeData"
    | "workspaceRef"
    | "setWorkspaceState"
    | "setActiveAreaId"
    | "setShowAnswer"
  >,
) {
  const {
    workspace,
    workspaceLifetime,
    captureCleanupTargets,
    invalidateWorkspaceOperations,
    syncConflictGeneration,
    setSyncConflictWorkspace,
    store,
    mediaStore,
    clearLocalStores,
    clearAuxiliaryNativeData,
    workspaceRef,
    setWorkspaceState,
    setActiveAreaId,
    setShowAnswer,
  } = model;
  async function exportAccountData(): Promise<string> {
    const result = await Effect.runPromise(Effect.either(exportNativeAccountData(workspace)));
    return Either.isRight(result)
      ? "Account export is ready to save or share."
      : "Account export could not be prepared. Check your connection and try again.";
  }
  async function deleteAccountData(): Promise<string> {
    if (workspaceLifetime.isBlocked())
      return "Local cleanup is already pending. Finish resetting this device first.";
    const targets = captureCleanupTargets();
    invalidateWorkspaceOperations();
    workspaceLifetime.pauseWrites();
    syncConflictGeneration.current = null;
    setSyncConflictWorkspace(null);
    const cloudDeleted = await Effect.runPromise(Effect.either(deleteNativeAccount()));
    if (Either.isLeft(cloudDeleted)) {
      workspaceLifetime.resumeWrites();
      return "Account deletion failed. Your account and local data remain available.";
    }

    const localCleanup = await Effect.runPromise(
      Effect.gen(function* () {
        const workspaceAndMedia =
          store && mediaStore
            ? yield* withNativeOperationStoreLane(clearLocalStores.current)
            : { workspaceCleared: false, mediaCleared: false };
        const auxiliary = yield* clearAuxiliaryNativeData(targets);
        return {
          ...workspaceAndMedia,
          ...auxiliary,
        } as const;
      }),
    );
    const authClient = supabaseAuthClient;
    const signedOut = authClient
      ? await Effect.runPromise(
          Effect.either(
            Effect.tryPromise({
              try: () => authClient.auth.signOut({ scope: "local" }),
              catch: () => ({ _tag: "LocalSignOutFailure" }) as const,
            }),
          ),
        )
      : null;
    workspaceRef.current = null;
    setWorkspaceState(null);
    setActiveAreaId(null);
    setShowAnswer(false);
    if (
      !localCleanup.workspaceCleared ||
      !localCleanup.mediaCleared ||
      !localCleanup.tutorSessionsCleared ||
      !localCleanup.pendingOperationsCleared
    ) {
      return "Account deleted. This device could not remove all local data; clear it before lending or recycling the device.";
    }
    if (signedOut && (Either.isLeft(signedOut) || signedOut.right.error)) {
      return "Account and local data deleted, but this device could not clear its saved sign-in session.";
    }
    return "Account and synced data deleted. This device’s workspace and attachments were removed.";
  }
  return { exportAccountData, deleteAccountData } as const;
}
