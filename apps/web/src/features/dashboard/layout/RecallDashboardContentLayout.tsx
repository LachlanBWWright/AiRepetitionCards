import { DashboardView } from "@/features/dashboard/navigation/dashboard-navigation";
import { Button } from "@/components/ui/Button";
import { Alert } from "@recall/ui-web/components/alert";
import { SidebarInset, SidebarTrigger } from "@recall/ui-web/components/sidebar";
import { RecallDashboardImportConfirmation } from "../transfers/RecallDashboardImportConfirmation";
import { RecallDashboardTutor } from "../subjects/RecallDashboardTutor";
import { RecallSubjectOverview } from "../subjects/RecallSubjectOverview";
import { RecallDashboardHome } from "../subjects/RecallDashboardHome";
import { RecallSubjectHeader } from "../subjects/RecallSubjectHeader";
import { RecallDashboardStudyCard } from "../review/RecallDashboardStudyCard";
import { RecallDashboardStudyView } from "../review/RecallDashboardStudyView";
import { RecallDashboardAlert } from "./RecallDashboardAlert";
import { RecallDashboardReviewRecoveryLayout } from "../review/RecallDashboardReviewRecoveryLayout";
import { RecallDashboardLibraryView } from "../library/RecallDashboardLibraryView";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
export function RecallDashboardContentLayout({ model }: { readonly model: RecallDashboardModel }) {
  const {
    workspaceUnlocked,
    stale,
    erased,
    contentImportBusy,
    pendingContentImport,
    reviewSaveFailed,
    libraryMutation,
    deletionRequest,
    retryDeletion,
    setDeletionRequest,
    activeView,
    practiceId,
  } = model;
  function deletionButtonLabel(request: NonNullable<typeof deletionRequest>) {
    return request.stale ? "Review and confirm latest deletion" : "Retry saved deletion request";
  }
  function cancelDeletionRequest() {
    setDeletionRequest(null);
  }
  const chat =
    workspaceUnlocked &&
    (activeView === DashboardView.Tutor || activeView === DashboardView.Improve);
  return (
    <SidebarInset
      className={chat ? "flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden" : "min-w-0"}
      id="today"
    >
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2 md:hidden">
        <SidebarTrigger
          className="size-9 w-9"
          aria-label="Open navigation"
          title="Open navigation"
        />
        <a className="font-semibold text-foreground no-underline" href="#today">
          Recall
        </a>
      </div>
      {!workspaceUnlocked ? (
        <RecallDashboardStudyView model={model} />
      ) : (
        <>
          {stale && !erased && <RecallDashboardAlert model={model} />}
          {(contentImportBusy || pendingContentImport) && (
            <RecallDashboardImportConfirmation model={model} />
          )}
          {reviewSaveFailed && <RecallDashboardReviewRecoveryLayout model={model} />}

          {(libraryMutation === "area-delete" || libraryMutation === "card-delete") && (
            <Alert className="my-3 flex flex-wrap items-center gap-2" role="status">
              Saving deletion on this device… The content remains available until saving completes.
            </Alert>
          )}
          {deletionRequest && libraryMutation === null && (
            <Alert className="my-3 flex flex-wrap items-center gap-2" variant="destructive">
              <span>{deletionRequest.error}</span>
              <Button onClick={() => void retryDeletion()}>
                {deletionButtonLabel(deletionRequest)}
              </Button>
              <Button onClick={cancelDeletionRequest}>Cancel deletion request</Button>
            </Alert>
          )}

          {(practiceId ||
            activeView === DashboardView.Tutor ||
            activeView === DashboardView.Improve ||
            (activeView === DashboardView.Library && model.libraryDeckOpen)) && (
            <RecallSubjectHeader model={model} />
          )}
          {activeView === DashboardView.Tutor ||
          activeView === DashboardView.Improve ? null : activeView === DashboardView.Today ? (
            <>
              {!practiceId ? (
                <RecallDashboardHome model={model} />
              ) : (
                <RecallDashboardStudyCard model={model} />
              )}
            </>
          ) : activeView === DashboardView.Insights ? (
            <RecallDashboardLibraryView model={model} />
          ) : model.libraryDeckOpen ? (
            <RecallSubjectOverview model={model} />
          ) : (
            <RecallDashboardHome model={model} />
          )}
          <RecallDashboardTutor key={model.notesScope} model={model} />
        </>
      )}
    </SidebarInset>
  );
}
