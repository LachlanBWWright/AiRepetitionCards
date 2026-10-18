import { Effect, Either } from "effect";
import { workspaceAuthoringBaseline } from "@recall/application";
import { type LearningArea, type Assessment } from "@/features/workspace/types";
import {
  type DeletionCommand,
  type DeletionRequest,
} from "@/features/dashboard/layout/RecallDashboardSupport";
import type { RecallDashboardCore } from "../../state/useRecallDashboardController";
import type { createRecallDashboardBulkActions } from "./RecallDashboardBulkActions";
export function createRecallDashboardDeletionActions(
  model: Pick<
    RecallDashboardCore & ReturnType<typeof createRecallDashboardBulkActions>,
    | "libraryMutationPending"
    | "cardSavePending"
    | "setLibraryMutation"
    | "setDeletionRequest"
    | "saveAuthoringCommand"
    | "cardEditorMounted"
    | "setSelectedId"
    | "setShowAnswer"
    | "setImportNotice"
    | "accountStatus"
    | "workspaceRef"
    | "requestConfirmation"
    | "deletionRequest"
  >,
) {
  const {
    libraryMutationPending,
    cardSavePending,
    setLibraryMutation,
    setDeletionRequest,
    saveAuthoringCommand,
    cardEditorMounted,
    setSelectedId,
    setShowAnswer,
    setImportNotice,
    accountStatus,
    workspaceRef,
    requestConfirmation,
    deletionRequest,
  } = model;
  async function commitDeletion(request: DeletionRequest) {
    if (libraryMutationPending.current || cardSavePending.current) return;
    libraryMutationPending.current = true;
    setLibraryMutation(request.command.kind === "delete-area" ? "area-delete" : "card-delete");
    setDeletionRequest(request);
    const result = await Effect.runPromise(
      Effect.either(saveAuthoringCommand(request.command, request.baseline)),
    );
    libraryMutationPending.current = false;
    if (!cardEditorMounted.current) return;
    setLibraryMutation(null);
    if (Either.isLeft(result)) {
      setDeletionRequest({
        ...request,
        error: result.left.message,
        stale: result.left.reason === "stale-content",
      });
      return;
    }
    setDeletionRequest(null);
    if (request.command.kind === "delete-area")
      setSelectedId((currentSelected) =>
        currentSelected === request.command.areaId
          ? (result.right.areas[0]?.id ?? "")
          : currentSelected,
      );
    setShowAnswer(false);
    setImportNotice(
      accountStatus === "signed-in"
        ? `${request.label} was removed. Syncing the change to your account…`
        : `${request.label} was removed. Your review history is retained.`,
    );
  }
  function deleteArea(target: LearningArea) {
    if (libraryMutationPending.current || cardSavePending.current)
      return Promise.resolve(undefined);
    const current = workspaceRef.current;
    const latest = current.areas.find((item) => item.id === target.id);
    if (!latest) {
      setImportNotice("This deck is no longer available. Your workspace was preserved.");
      return Promise.resolve(undefined);
    }
    const command: DeletionCommand = { kind: "delete-area", areaId: latest.id };
    const baseline = workspaceAuthoringBaseline(current, command) ?? "";
    requestConfirmation(
      `Delete “${latest.title}” and its ${String(latest.cards.length)} cards? Its review history will be retained.`,
      () => commitDeletion({ command, baseline, label: latest.title, error: "", stale: false }),
    );

    return Promise.resolve(undefined);
  }
  async function retryDeletion() {
    if (!deletionRequest || libraryMutationPending.current) return;
    if (!deletionRequest.stale) {
      await commitDeletion(deletionRequest);
      return;
    }
    const current = workspaceRef.current;
    const latestArea = current.areas.find((item) => item.id === deletionRequest.command.areaId);
    if (!latestArea) {
      setDeletionRequest({
        ...deletionRequest,
        error:
          "This content is no longer available. Cancel this deletion request and inspect your current library.",
      });
      return;
    }
    if (deletionRequest.command.kind === "delete-area") {
      await deleteArea(latestArea);
      return;
    }
    const requestedCardId = deletionRequest.command.cardId;
    const latestCard = latestArea.cards.find((item) => item.id === requestedCardId);
    if (!latestCard) {
      setDeletionRequest({
        ...deletionRequest,
        error:
          "This card is no longer available. Cancel this deletion request and inspect your current library.",
      });
      return;
    }
    await deleteCard(latestCard);
  }
  function deleteCard(target: Assessment) {
    if (libraryMutationPending.current || cardSavePending.current)
      return Promise.resolve(undefined);
    const current = workspaceRef.current;
    const latestArea = current.areas.find((item) =>
      item.cards.some((card) => card.id === target.id),
    );
    const latestCard = latestArea?.cards.find((item) => item.id === target.id);
    if (!latestArea || !latestCard) {
      setImportNotice("This card is no longer available. Your workspace was preserved.");
      return Promise.resolve(undefined);
    }
    const command: DeletionCommand = {
      kind: "delete-card",
      areaId: latestArea.id,
      cardId: latestCard.id,
    };
    const baseline = workspaceAuthoringBaseline(current, command) ?? "";
    requestConfirmation(
      `Delete this study card from “${latestArea.title}”?\n\n${latestCard.front}\n\nIts review history will remain.`,
      () => commitDeletion({ command, baseline, label: latestCard.front, error: "", stale: false }),
    );

    return Promise.resolve(undefined);
  }
  return { commitDeletion, deleteArea, retryDeletion, deleteCard } as const;
}
