import {
  applyMediaTrashPurge,
  nextStudyArea,
  libraryDraftMediaReferences,
  suspensionSettings,
  toggleCardFlag,
  workspaceAuthoringBaseline,
} from "@recall/application";
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
    mediaStore,
    mediaRevision,
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
      workspaceStore={store ?? undefined}
      onPurged={(result) => {
        model.setWorkspace((current) =>
          current ? applyMediaTrashPurge(current, result) : current,
        );
      }}
      protectedReferences={libraryDraftMediaReferences(libraryNotes.notes)}
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
      onStudyCommand={model.applyAuthoringCommand}
      onSuspend={() => {
        if (!workspace || !model.card) return;
        const settings = suspensionSettings(workspace, model.card.id);
        const command = { kind: "update-scheduler-settings", settings } as const;
        void model.applyAuthoringCommand(command, workspaceAuthoringBaseline(workspace, command));
      }}
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
        const next = workspace ? nextStudyArea(workspace, now, activeArea?.id) : undefined;
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
      mediaStore={mediaStore}
      mediaRevision={mediaRevision}
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
