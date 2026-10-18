import { NativeWorkspaceSearchHistory } from "../NativeWorkspaceSearchHistory";

import type { ComponentProps } from "react";
import type { NativeWorkspaceAuthoringController } from "../useNativeWorkspaceAuthoringController";
export function createSearchHistorySection(
  input: Pick<
    NativeWorkspaceAuthoringController,
    | "workspace"
    | "locked"
    | "searchTarget"
    | "editor"
    | "history"
    | "showDuplicates"
    | "duplicatePairs"
    | "openExistingCard"
    | "setHistory"
    | "setShowDuplicates"
    | "setObjectiveSelection"
    | "setShowFilters"
    | "submit"
  >,
) {
  const {
    workspace,
    locked,
    searchTarget,
    editor,
    history,
    showDuplicates,
    duplicatePairs,
    openExistingCard,
    setHistory,
    setShowDuplicates,
    setObjectiveSelection,
    setShowFilters,
    submit,
  } = input;
  const props: ComponentProps<typeof NativeWorkspaceSearchHistory> = {
    searchTarget,
    workspace,
    locked,
    editor,
    history,
    showDuplicates,
    duplicatePairs,
    onOpenSearchCard: () => {
      if (searchTarget?.target.kind === "card")
        openExistingCard(searchTarget.areaId, searchTarget.target.cardId, true);
    },
    onFilterObjective: (areaId, objectiveId) => {
      setObjectiveSelection({ areaId, value: `id:${objectiveId}` });
      setShowFilters(true);
    },
    onToggleHistory: () => {
      setHistory(history ? null : {});
    },
    onRestore: submit,
    onToggleDuplicates: () => {
      setShowDuplicates(!showDuplicates);
    },
    onEditDuplicate: (areaId, cardId) => {
      if (areaId) openExistingCard(areaId, cardId, false);
    },
  };
  return props;
}
