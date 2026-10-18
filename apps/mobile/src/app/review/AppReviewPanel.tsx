import { toggleCardFlag } from "@recall/application";
import { NativeTodayScreen } from "../../components/review/NativeTodayScreen";
import { NativeDeepPracticeRecommendations } from "../../components/review/NativeDeepPracticeRecommendations";
import { NativeAppTab as AppTab } from "../../navigation";
import type { AppModel } from "../useAppController";
export function AppReviewPanel({ model }: { readonly model: AppModel }) {
  const {
    deepPracticeRecommendations,
    libraryNotes,
    authoringDisabledReason,
    setActiveAreaId,
    setLearningActivityId,
    setOnlyFlagged,
    setActiveTab,
    studySession,
    activeArea,
    workspace,
    now,
    startStudy,
    ready,
    activeAreaId,
    message,
    mediaUris,
    showAnswer,
    reviewPending,
    store,
    setShowAnswer,
    review,
    resetLocalWorkspace,
    importAnkiDeck,
  } = model;
  return (
    <NativeTodayScreen
      embedded
      deepPractice={
        <NativeDeepPracticeRecommendations
          recommendations={deepPracticeRecommendations}
          disabled={!libraryNotes.loaded || authoringDisabledReason !== undefined}
          onStart={(areaId, activityId) => {
            setActiveAreaId(areaId);
            setLearningActivityId(activityId);
            setOnlyFlagged(false);
            model.setSubjectMode("overview");
            setActiveTab(AppTab.Library);
          }}
        />
      }
      flaggedCardIds={libraryNotes.notes.flaggedCardIds}
      onFlag={(id) => {
        libraryNotes.update((notes) => toggleCardFlag(notes, id));
      }}
      onEditFlagged={() => {
        setOnlyFlagged(true);
        model.setSubjectMode("overview");
        setActiveTab(AppTab.Library);
      }}
      sessionEvents={
        studySession && studySession.areaId === activeArea?.id ? studySession.events : []
      }
      onNextDeck={() => {
        const next = workspace?.areas.find(
          (area) =>
            area.id !== activeArea?.id &&
            area.cards.some((card) => Date.parse(card.schedule.due) <= now),
        );
        if (next) startStudy(next.id);
      }}
      onOpenLibrary={() => {
        model.setSubjectMode("overview");
        setActiveTab(AppTab.Library);
      }}
      ready={ready}
      workspace={workspace}
      activeAreaId={activeAreaId}
      now={now}
      message={message}
      mediaUris={mediaUris}
      showAnswer={showAnswer}
      reviewPending={reviewPending}
      canReset={store !== null}
      onSelectArea={startStudy}
      onHideAnswer={() => {
        setShowAnswer(false);
      }}
      onShowAnswer={() => {
        setShowAnswer(true);
      }}
      onReview={(rating) => void review(rating)}
      onReset={resetLocalWorkspace}
      onImportAnki={() => void importAnkiDeck()}
    />
  );
}
