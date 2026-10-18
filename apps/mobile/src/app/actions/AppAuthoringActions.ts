import { Effect, Either, Schema } from "effect";
import {
  applyWorkspaceAuthoringCommand,
  WorkspaceAuthoringCommandSchema,
  verifyMediaAsset,
} from "@recall/application";
import type { StoredMediaAsset } from "@recall/local-store";
import type { Workspace } from "@recall/domain";
import type { AppCoreState } from "../useAppController";
import type { createAppWorkspaceActions } from "./AppWorkspaceActions";
function workspaceRetainsAsset(workspace: Workspace, asset: StoredMediaAsset): boolean {
  return workspace.areas.some((area) =>
    area.cards.some((card) =>
      card.media?.some(
        (reference) =>
          reference.id === asset.reference.id &&
          reference.mimeType === asset.reference.mimeType &&
          reference.byteLength === asset.reference.byteLength,
      ),
    ),
  );
}
export function createAppAuthoringActions(
  model: Pick<
    AppCoreState & ReturnType<typeof createAppWorkspaceActions>,
    | "operationGeneration"
    | "authSession"
    | "reviewInProgress"
    | "store"
    | "cacheWritable"
    | "workspaceLifetime"
    | "commitWorkspaceChange"
    | "setCacheWritable"
    | "setMessage"
    | "activeAreaId"
    | "setActiveAreaId"
    | "setShowAnswer"
    | "setMediaUris"
    | "setNow"
    | "setMediaRevision"
    | "libraryNotes"
  >,
) {
  const {
    operationGeneration,
    authSession,
    reviewInProgress,
    store,
    cacheWritable,
    workspaceLifetime,
    commitWorkspaceChange,
    setCacheWritable,
    setMessage,
    activeAreaId,
    setActiveAreaId,
    setShowAnswer,
    setMediaUris,
    setNow,
    setMediaRevision,
    libraryNotes,
  } = model;
  async function applyAuthoringCommand(
    command: unknown,
    expectedBaseline?: string,
    stagedMedia: readonly StoredMediaAsset[] = [],
  ): Promise<{ readonly ok: boolean; readonly message: string }> {
    const generation = operationGeneration;
    const authGeneration = authSession.current.generation;
    if (reviewInProgress.current)
      return { ok: false, message: "Wait for the pending review to save before editing." };
    if (!store || !cacheWritable || workspaceLifetime.isBlocked())
      return {
        ok: false,
        message:
          "Your changes can’t be saved yet. Finish the device reset or reopen the app before editing. Your cards are still available.",
      };
    if (stagedMedia.length > 20 || stagedMedia.some((asset) => !verifyMediaAsset(asset)))
      return { ok: false, message: "Attachments could not be verified. Choose the files again." };
    const isCurrent = () =>
      workspaceLifetime.generation() === generation &&
      !workspaceLifetime.isBlocked() &&
      authSession.current.generation === authGeneration;
    let selectedAreaId: string | undefined;
    let successMessage = "Changes saved.";
    const saved = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange(
          (current) =>
            applyWorkspaceAuthoringCommand(current, command, new Date(), expectedBaseline).pipe(
              Effect.map((result) => {
                selectedAreaId = result.selectedAreaId;
                successMessage = result.message;
                return result.workspace;
              }),
            ),
          generation,
          {
            persistFirst: true,
            retainBindingOnAuthChange: true,
            isCurrent,
            mediaForWorkspace: (next) =>
              stagedMedia.filter((asset) => workspaceRetainsAsset(next, asset)),
          },
        ),
      ),
    );
    if (Either.isLeft(saved)) {
      const failure = saved.left;
      if (failure._tag === "NativeWorkspacePersistenceFailed") setCacheWritable(false);
      const notice =
        failure._tag === "WorkspaceAuthoringFailure"
          ? failure.message
          : failure._tag === "NativeWorkspaceUnavailable"
            ? failure.persisted
              ? "Changes were saved locally before your account changed. Review the current library before retrying your draft."
              : "This workspace or account changed. Review your draft before trying again."
            : "Save not confirmed. The draft is still here. Free device storage or reopen the app, then retry saving.";
      setMessage(notice);
      return { ok: false, message: notice };
    }
    if (!isCurrent())
      return {
        ok: false,
        message:
          "The save finished before this workspace or account changed. Review the current library before retrying your draft.",
      };
    const preferred = selectedAreaId ?? activeAreaId;
    setActiveAreaId(
      saved.right.areas.some((area) => area.id === preferred)
        ? (preferred ?? null)
        : (saved.right.areas[0]?.id ?? null),
    );
    setShowAnswer(false);
    setMediaUris({});
    setNow(Date.now());
    setMediaRevision((revision) => revision + 1);
    const decodedCommand = Schema.decodeUnknownEither(WorkspaceAuthoringCommandSchema)(command);
    if (Either.isRight(decodedCommand) && decodedCommand.right.kind === "update-card") {
      const editedId = decodedCommand.right.cardId;
      libraryNotes.update((notes) => ({
        ...notes,
        flaggedCardIds: notes.flaggedCardIds.filter((id) => id !== editedId),
      }));
    }
    setMessage(successMessage);
    return { ok: true, message: successMessage };
  }
  return { applyAuthoringCommand } as const;
}
