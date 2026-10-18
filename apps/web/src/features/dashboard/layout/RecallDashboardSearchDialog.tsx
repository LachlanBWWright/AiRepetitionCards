import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@recall/ui-web/components/dialog";
import { WorkspaceSearchPanel } from "@/components/search/WorkspaceSearchPanel";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
export function RecallDashboardSearchDialog({ model }: { readonly model: RecallDashboardModel }) {
  const { searchOpen, workspaceUnlocked, setSearchOpen, workspace, openSearchResult, demo } = model;
  return (
    <Dialog open={searchOpen && workspaceUnlocked} onOpenChange={setSearchOpen}>
      <DialogContent className="gap-5 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle id="workspace-search-title">Search</DialogTitle>
        </DialogHeader>
        <WorkspaceSearchPanel
          workspace={workspace}
          ownershipKey={workspace.syncOwnerId ?? "local"}
          onOpenResult={openSearchResult}
          {...(demo ? { demoNotebooks: [] } : {})}
        />
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setSearchOpen(false);
            }}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
