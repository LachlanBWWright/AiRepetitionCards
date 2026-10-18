import { Button } from "@/components/ui/Button";
import { Alert } from "@recall/ui-web/components/alert";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
export function RecallDashboardImportConfirmation({
  model,
}: {
  readonly model: RecallDashboardModel;
}) {
  const {
    contentImportBusy,
    pendingContentImport,
    commitContentImport,
    workspaceRef,
    requestConfirmation,
    setPendingContentImport,
    setImportNotice,
  } = model;
  function retryImport() {
    if (!pendingContentImport) return;
    const retry = () =>
      void commitContentImport({
        ...pendingContentImport,
        expectedWorkspace: workspaceRef.current,
      });
    if (pendingContentImport.replacement)
      requestConfirmation(
        "Replace the current workspace with this backup? Changes made since the earlier attempt will be replaced.",
        retry,
      );
    else retry();
  }
  return (
    <Alert
      className="my-3 flex flex-wrap items-center gap-2"
      role={contentImportBusy ? "status" : "alert"}
    >
      {contentImportBusy
        ? "Saving imported content…"
        : "Save not confirmed. The imported cards are still here. Retry saving or cancel the import."}
      {!contentImportBusy && pendingContentImport && (
        <>
          <Button onClick={retryImport}>Retry saving import</Button>
          <Button
            onClick={() => {
              setPendingContentImport(null);
              setImportNotice("Import cancelled. Your current workspace remains available.");
            }}
          >
            Cancel import
          </Button>
        </>
      )}
    </Alert>
  );
}
