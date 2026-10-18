import { Button } from "@/components/ui/Button";
import { Alert } from "@recall/ui-web/components/alert";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
export function RecallDashboardReviewRecoveryLayout({
  model,
}: {
  readonly model: RecallDashboardModel;
}) {
  const {
    erased,
    stale,
    pendingReviewRef,
    review,
    exportWorkspaceSnapshot,
    exportWorkspaceBackup,
  } = model;
  return (
    <Alert className="my-3 flex flex-wrap items-center gap-2" variant="destructive">
      This review’s save hasn’t been confirmed. Your answer is still here. Retry saving before
      continuing.
      <Button
        disabled={erased || stale}
        onClick={() => {
          const rating = pendingReviewRef.current?.rating ?? "good";
          void review(rating);
        }}
      >
        Retry review save
      </Button>
      <details className="text-sm">
        <summary>More recovery options</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button onClick={exportWorkspaceSnapshot}>Export unsaved work</Button>
          <Button onClick={() => void exportWorkspaceBackup()}>Export workspace backup</Button>
        </div>
      </details>
    </Alert>
  );
}
