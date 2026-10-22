import { formatTagInput } from "@recall/application";
import { dashboardColors as colors } from "@/features/dashboard/layout/RecallDashboardSupport";
import type { RecallDashboardCore } from "../../state/useRecallDashboardController";

export function createRecallDashboardEditorCloseActions(
  model: Pick<
    RecallDashboardCore,
    | "libraryMutationPending"
    | "areaEditor"
    | "setAddingArea"
    | "setEditingAreaId"
    | "setAreaTitle"
    | "setAreaColor"
    | "workspaceRef"
    | "setAreaEditorError"
    | "setAreaDraftStale"
    | "cardSavePending"
    | "cardEditor"
    | "setCardEditorError"
    | "setCardDraftStale"
    | "setAddingCard"
    | "setEditingCardId"
    | "setFront"
    | "setBack"
    | "setImageOcclusion"
    | "setCardKind"
    | "setClozeText"
    | "setClozeIndex"
    | "setCardObjectiveIds"
    | "setCardPresentation"
    | "setCardTags"
    | "setRemovedMediaIds"
    | "setMediaFile"
    | "setDuplicateAcknowledgement"
  >,
) {
  const {
    libraryMutationPending,
    areaEditor,
    setAddingArea,
    setEditingAreaId,
    setAreaTitle,
    setAreaColor,
    workspaceRef,
    setAreaEditorError,
    setAreaDraftStale,
    cardSavePending,
    cardEditor,
    setCardEditorError,
    setCardDraftStale,
    setAddingCard,
    setEditingCardId,
    setFront,
    setBack,
    setImageOcclusion,
    setCardKind,
    setClozeText,
    setClozeIndex,
    setCardObjectiveIds,
    setCardPresentation,
    setCardTags,
    setRemovedMediaIds,
    setMediaFile,
    setDuplicateAcknowledgement,
  } = model;
  function closeAreaEditor() {
    if (libraryMutationPending.current) return;
    areaEditor.current = {
      generation: areaEditor.current.generation + 1,
      id: null,
      baseline: undefined,
    };
    setAddingArea(false);
    setEditingAreaId(null);
    setAreaTitle("");
    setAreaColor(colors[workspaceRef.current.areas.length % colors.length] ?? colors[0]);
    setAreaEditorError(null);
    setAreaDraftStale(false);
  }
  function closeCardEditor() {
    if (cardSavePending.current) return;
    cardEditor.current = {
      generation: cardEditor.current.generation + 1,
      baseline: undefined,
      sourceCard: null,
    };
    setCardEditorError(null);
    setCardDraftStale(false);
    setAddingCard(false);
    setEditingCardId(null);
    setFront("");
    setBack("");
    setImageOcclusion(undefined);
    setCardKind("basic");
    setClozeText("");
    setClozeIndex("1");
    setCardObjectiveIds([]);
    setCardPresentation(undefined);
    setCardTags(formatTagInput([]));
    setRemovedMediaIds([]);
    setMediaFile(null);
    setDuplicateAcknowledgement(null);
  }
  return { closeAreaEditor, closeCardEditor } as const;
}
