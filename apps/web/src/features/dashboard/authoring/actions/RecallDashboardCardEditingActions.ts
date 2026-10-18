import { formatTagInput } from "@recall/application";
import { type Assessment } from "@/features/workspace/types";
import { cardEditingBaseline } from "@/features/dashboard/layout/RecallDashboardSupport";
import type { RecallDashboardCore } from "../../state/useRecallDashboardController";
import type { createRecallDashboardAreaActions } from "./RecallDashboardAreaActions";
import type { createRecallDashboardEditorCloseActions } from "./RecallDashboardEditorCloseActions";
export function createRecallDashboardCardEditingActions(
  model: Pick<
    RecallDashboardCore &
      ReturnType<typeof createRecallDashboardAreaActions> &
      ReturnType<typeof createRecallDashboardEditorCloseActions>,
    | "cardSavePending"
    | "setDuplicateAcknowledgement"
    | "workspaceRef"
    | "cardEditor"
    | "setCardEditorError"
    | "setCardDraftStale"
    | "setSelectedId"
    | "setEditingCardId"
    | "setFront"
    | "setBack"
    | "setCardKind"
    | "setClozeText"
    | "setClozeIndex"
    | "setCardObjectiveIds"
    | "setCardTags"
    | "setRemovedMediaIds"
    | "setMediaFile"
    | "setAddingCard"
    | "area"
    | "addArea"
    | "closeCardEditor"
  >,
) {
  const {
    cardSavePending,
    setDuplicateAcknowledgement,
    workspaceRef,
    cardEditor,
    setCardEditorError,
    setCardDraftStale,
    setSelectedId,
    setEditingCardId,
    setFront,
    setBack,
    setCardKind,
    setClozeText,
    setClozeIndex,
    setCardObjectiveIds,
    setCardTags,
    setRemovedMediaIds,
    setMediaFile,
    setAddingCard,
    area,
    addArea,
    closeCardEditor,
  } = model;
  function editCard(target: Assessment) {
    if (cardSavePending.current) return;
    setDuplicateAcknowledgement(null);
    const latest = workspaceRef.current;
    const ownerArea = latest.areas.find((item) => item.cards.some((card) => card.id === target.id));
    if (!ownerArea) return;
    const latestCard = ownerArea.cards.find((card) => card.id === target.id);
    if (!latestCard) return;
    cardEditor.current = {
      generation: cardEditor.current.generation + 1,
      baseline: cardEditingBaseline(latest, ownerArea, latestCard),
      sourceCard: latestCard,
    };
    setCardEditorError(null);
    setCardDraftStale(false);
    setSelectedId(ownerArea.id);
    setEditingCardId(latestCard.id);
    setFront(latestCard.front);
    setBack(latestCard.back);
    setCardKind(latestCard.cloze ? "cloze" : "basic");
    setClozeText(latestCard.cloze?.text ?? "");
    setClozeIndex(String(latestCard.cloze?.deletionIndex ?? 1));
    setCardObjectiveIds(
      latestCard.objectiveIds ??
        (ownerArea.objectives ?? [])
          .filter((objective) => objective.title === latestCard.objective)
          .map((objective) => objective.id),
    );
    setCardTags(formatTagInput(latestCard.tags ?? []));
    setRemovedMediaIds([]);
    setMediaFile(null);
    setAddingCard(true);
  }
  function addCard() {
    if (cardSavePending.current) return;
    if (!area) {
      addArea();
      return;
    }
    closeCardEditor();
    setAddingCard(true);
  }
  return { editCard, addCard } as const;
}
