import type { SubjectActivity } from "@recall/application";
import { type WorkspaceSearchResult } from "@recall/application";
import { DashboardView } from "@/features/dashboard/navigation/dashboard-navigation";
import { type LearningArea } from "@/features/workspace/types";
import { localSnapshotStale } from "@/features/workspace/local-snapshot-status";
import { localWritesBlocked } from "@/features/workspace/local-write-coordinator";
import type { RecallDashboardCore } from "../state/useRecallDashboardController";
import type { createRecallDashboardEditorCloseActions } from "../authoring/actions/RecallDashboardEditorCloseActions";
import type { createRecallDashboardCardEditingActions } from "../authoring/actions/RecallDashboardCardEditingActions";
export function createRecallDashboardNavigationActions(
  model: Pick<
    RecallDashboardCore &
      ReturnType<typeof createRecallDashboardEditorCloseActions> &
      ReturnType<typeof createRecallDashboardCardEditingActions>,
    | "practiceAreaId"
    | "setPracticeAreaId"
    | "reviewSaving"
    | "reviewSaveFailed"
    | "setNow"
    | "setShowAnswer"
    | "setSelectedId"
    | "onPracticeChange"
    | "setLocalPracticeId"
    | "onViewChange"
    | "setLocalActiveView"
    | "setCreationChoices"
    | "setTutorActivity"
    | "selectedId"
    | "onActivityChange"
    | "setOnlyFlagged"
    | "setLocalActivityId"
    | "cardSavePending"
    | "libraryMutationPending"
    | "workspaceRef"
    | "setImportNotice"
    | "addingCard"
    | "addingArea"
    | "requestConfirmation"
    | "closeCardEditor"
    | "closeAreaEditor"
    | "setSearchOpen"
    | "setSearchTarget"
    | "setActiveView"
    | "editCard"
    | "setShowAreaSettings"
  >,
) {
  const {
    practiceAreaId,
    setPracticeAreaId,
    reviewSaving,
    reviewSaveFailed,
    setNow,
    setShowAnswer,
    setSelectedId,
    onPracticeChange,
    setLocalPracticeId,
    onViewChange,
    setLocalActiveView,
    setCreationChoices,
    setTutorActivity,
    selectedId,
    onActivityChange,
    setOnlyFlagged,
    setLocalActivityId,
    cardSavePending,
    libraryMutationPending,
    workspaceRef,
    setImportNotice,
    addingCard,
    addingArea,
    requestConfirmation,
    closeCardEditor,
    closeAreaEditor,
    setSearchOpen,
    setSearchTarget,
    setActiveView,
    editCard,
    setShowAreaSettings,
  } = model;
  function startPractice(id: string) {
    if (reviewSaving || reviewSaveFailed) return;
    // Resume the current subject session when returning from another activity.
    setNow(new Date());
    if (id !== practiceAreaId) setShowAnswer(false);
    setPracticeAreaId(id);
    setSelectedId(id);
    if (onPracticeChange) onPracticeChange(id);
    else {
      setLocalPracticeId(id);
      if (onViewChange) onViewChange(DashboardView.Today, id);
      else setLocalActiveView(DashboardView.Today);
    }
  }
  function openSubject(id: string, activity: SubjectActivity) {
    if (reviewSaving || reviewSaveFailed) return;
    setSelectedId(id);
    if (activity === "review") startPractice(id);
    else
      setActiveView(
        activity === "tutor"
          ? DashboardView.Tutor
          : activity === "improve"
            ? DashboardView.Improve
            : DashboardView.Library,
        id,
      );
  }
  function generateCards() {
    setCreationChoices(false);
    setTutorActivity("materials");
    if (onViewChange) onViewChange(DashboardView.Improve, selectedId, "materials");
    else setLocalActiveView(DashboardView.Improve);
  }
  function openLearningActivity(areaId: string, activityId: string) {
    if (onActivityChange) {
      onActivityChange(areaId, activityId);
      return;
    }
    setSelectedId(areaId);
    setOnlyFlagged(false);
    setLocalActivityId(activityId);
    setLocalActiveView(DashboardView.Library);
  }
  function openSearchResult(result: WorkspaceSearchResult) {
    if (
      reviewSaving ||
      reviewSaveFailed ||
      cardSavePending.current ||
      libraryMutationPending.current ||
      localWritesBlocked() ||
      localSnapshotStale()
    )
      return;
    const targetArea = workspaceRef.current.areas.find((item) => item.id === result.areaId);
    if (!targetArea) {
      setImportNotice("This search result is no longer available. Search again.");
      return;
    }
    if (addingCard || addingArea) {
      requestConfirmation("Discard the open draft and open this search result?", () => {
        openSearchResultAfterConfirmation(result, targetArea);
      });
      return;
    }
    openSearchResultAfterConfirmation(result, targetArea);
  }
  function openSearchResultAfterConfirmation(
    result: WorkspaceSearchResult,
    targetArea: LearningArea,
  ) {
    closeCardEditor();
    closeAreaEditor();
    setSearchOpen(false);
    setSelectedId(targetArea.id);
    setShowAnswer(false);
    setSearchTarget(result);
    if (result.target.kind === "card") {
      const targetId = result.target.cardId;
      const targetCard = targetArea.cards.find((item) => item.id === targetId);
      setActiveView(DashboardView.Library, targetArea.id);
      if (targetCard) editCard(targetCard);
      else setImportNotice("This card is no longer available. Search again.");
    } else if (result.target.kind === "area" || result.target.kind === "objective") {
      setActiveView(DashboardView.Library, targetArea.id);
      setShowAreaSettings(result.target.kind === "objective");
    } else setActiveView(DashboardView.Improve, targetArea.id);
  }
  return {
    startPractice,
    openSubject,
    generateCards,
    openLearningActivity,
    openSearchResult,
    openSearchResultAfterConfirmation,
  } as const;
}
