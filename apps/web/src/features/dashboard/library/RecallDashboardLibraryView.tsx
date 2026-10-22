import { Effect } from "effect";
import { DashboardView } from "@/features/dashboard/navigation/dashboard-navigation";
import { Button } from "@/components/ui/Button";
import { DeckOverview } from "@/components/knowledge/overview/DeckOverview";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@recall/ui-web/components/dialog";
import { Alert } from "@recall/ui-web/components/alert";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeletedCardRecovery } from "@/components/knowledge/library/recovery/DeletedCardRecovery";
import { SchedulerSettings } from "@/components/knowledge/settings/SchedulerSettings";
import type { SchedulerSettings as SchedulerPreferences } from "@recall/domain";
import { RecallDashboardInsightsSummary } from "@/features/dashboard/review/RecallDashboardInsightsSummary";
import { StudyStatisticsPanel } from "../review/StudyStatisticsPanel";
import { RecallDashboardLibraryToolbar } from "./RecallDashboardLibraryToolbar";
import { RecallDashboardResumeADraft } from "../authoring/drafts/RecallDashboardResumeADraft";
import { RecallDashboardDeckToolbar } from "./RecallDashboardDeckToolbar";
import { RecallDashboardCardLibrary } from "./RecallDashboardCardLibrary";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";

function BrowseSharedDeckButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button variant="link" className="h-auto p-0" onClick={onClick}>
        Browse shared decks
      </Button>
    </div>
  );
}

export function RecallDashboardLibraryView({ model }: { readonly model: RecallDashboardModel }) {
  const {
    reviewSaving,
    reviewSaveFailed,
    activeView,
    libraryNotes,
    activityRestoreError,
    libraryDeckOpen,
    workspace,
    editArea,
    setSelectedId,
    setShowAreaSettings,
    deleteArea,
    now,
    setOnlyFlagged,
    setShowAnswer,
    onViewChange,
    libraryMutation,
    cardSaving,
    onOpenDeckPage,
    setSharingTab,
    setShareKnowledgeOpen,
    restoreVersion,
    area,
    totalReviews,
    dueCount,
    studiedToday,
    practice,
    retainedCards,
    deletedRetainedAreas,
    retainedPendingReviews,
    missingDeletedReviewContent,
    deletedReviewProvisionCapacity,
    exportWorkspaceSnapshot,
    exportWorkspaceBackup,
    setActiveView,
    reviewHistory,
    reviewSettingsOpen,
    workspaceUnlocked,
    setReviewSettingsOpen,
    workspaceRef,
    saveAuthoringCommand,
  } = model;
  function saveSchedulerSettings(settings: SchedulerPreferences, expectedBaseline: string) {
    return saveAuthoringCommand(
      { kind: "update-scheduler-settings", settings },
      expectedBaseline,
    ).pipe(
      Effect.mapError((error) => ({ ...error, _tag: "SchedulerSettingsSaveFailure" as const })),
    );
  }
  function openAreaSettings(areaId: string) {
    setSelectedId(areaId);
    setShowAreaSettings(true);
  }
  function openSettingsForArea(target: Parameters<typeof editArea>[0]) {
    openAreaSettings(target.id);
  }
  function openDeck(areaId: string) {
    setOnlyFlagged(false);
    setSelectedId(areaId);
    setShowAnswer(false);
    if (onViewChange) onViewChange(DashboardView.Library, areaId);
  }
  const restoringDeletedCard =
    cardSaving || libraryMutation !== null || reviewSaving || reviewSaveFailed;
  function openSharing() {
    if (onOpenDeckPage) {
      onOpenDeckPage();
      return;
    }
    setSharingTab("browse");
    setShareKnowledgeOpen(true);
  }
  return (
    <div
      className="mx-auto min-h-[80vh] w-full max-w-[1080px] px-4 py-8 sm:px-8 sm:py-10"
      inert={reviewSaving || reviewSaveFailed}
    >
      <RecallDashboardLibraryToolbar model={model} />
      {activeView === DashboardView.Library ? (
        <>
          <div className="mt-7 grid gap-7">
            {(libraryNotes.error || activityRestoreError) && (
              <Alert variant="destructive">
                {libraryNotes.error ?? activityRestoreError}
                <Button onClick={libraryNotes.retry}>Retry retaining drafts</Button>
              </Alert>
            )}
            {libraryNotes.notes.drafts.length > 0 && <RecallDashboardResumeADraft model={model} />}
            {!libraryDeckOpen && (
              <DeckOverview
                areas={workspace.areas}
                onEdit={editArea}
                onSettings={openSettingsForArea}
                onDelete={(target) => void deleteArea(target)}
                now={now.getTime()}
                onOpen={openDeck}
                disabled={libraryMutation !== null || cardSaving || reviewSaving}
              />
            )}
            {!libraryDeckOpen && <BrowseSharedDeckButton onClick={openSharing} />}
            {!libraryDeckOpen && (
              <DeletedCardRecovery
                workspace={workspace}
                onRestoreVersion={restoreVersion}
                disabled={restoringDeletedCard}
              />
            )}
            <RecallDashboardDeckToolbar model={model} />
            {!area && (
              <EmptyState
                className="rounded-xl border bg-card px-6 py-12"
                title="Create your first deck"
                description="A deck groups cards for a subject. Write cards, generate them from materials, or import an existing deck."
              />
            )}
            <RecallDashboardCardLibrary model={model} />
          </div>
        </>
      ) : (
        <>
          <RecallDashboardInsightsSummary
            totalReviews={totalReviews}
            dueCount={dueCount}
            areaCount={workspace.areas.length}
            studiedToday={studiedToday}
            week={practice.week}
            retainedCards={retainedCards}
            deletedRetainedAreas={deletedRetainedAreas}
            retainedPendingReviews={retainedPendingReviews}
            missingDeletedReviewContent={missingDeletedReviewContent}
            deletedReviewProvisionCapacity={deletedReviewProvisionCapacity}
            onExportSnapshot={exportWorkspaceSnapshot}
            onExportBackup={() => {
              void exportWorkspaceBackup();
            }}
            onOpenLibrary={() => {
              setActiveView(DashboardView.Library);
            }}
            reviewHistory={reviewHistory}
            totalReviewEvents={workspace.reviewEvents?.length ?? 0}
          />
          <StudyStatisticsPanel workspace={workspace} now={now.getTime()} />
          <DeletedCardRecovery
            workspace={workspace}
            onRestoreVersion={restoreVersion}
            disabled={restoringDeletedCard}
          />
        </>
      )}
      {activeView === DashboardView.Insights && (
        <Dialog open={reviewSettingsOpen && workspaceUnlocked} onOpenChange={setReviewSettingsOpen}>
          <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Review settings</DialogTitle>
              <DialogDescription>
                Adjust how reviews are scheduled for your workspace.
              </DialogDescription>
            </DialogHeader>
            <SchedulerSettings
              workspace={workspace}
              readLatest={() => workspaceRef.current}
              onSave={saveSchedulerSettings}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
