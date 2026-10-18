import { Button } from "@/components/ui/Button";
import { Alert } from "@recall/ui-web/components/alert";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
export function RecallDashboardAlert({ model }: { readonly model: RecallDashboardModel }) {
  const { exportWorkspaceBackup, exportWorkspaceSnapshot, demo } = model;
  return (
    <Alert className="my-3 flex flex-wrap items-center gap-2" variant="destructive">
      Another tab saved newer changes. Your unsaved work is still here. Export it, then reload to
      continue.
      <Button onClick={() => void exportWorkspaceBackup()}>Export this tab backup</Button>
      <Button
        onClick={() => {
          exportWorkspaceSnapshot();
        }}
      >
        Export JSON snapshot
      </Button>
      <Button
        onClick={() => {
          if (!demo) window.location.reload();
        }}
      >
        Reload latest saved workspace
      </Button>
    </Alert>
  );
}
