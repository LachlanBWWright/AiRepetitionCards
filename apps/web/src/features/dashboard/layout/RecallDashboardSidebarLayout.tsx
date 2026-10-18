import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
} from "@recall/ui-web/components/sidebar";
import { DashboardView } from "../navigation/dashboard-navigation";
import { RecallDashboardNavigation } from "../navigation/RecallDashboardNavigation";
import { RecallDashboardSyncRecovery } from "../storage/RecallDashboardSyncRecovery";
import { RecallDashboardSidebarMenu } from "./RecallDashboardSidebarMenu";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
export function RecallDashboardSidebarLayout({ model }: { readonly model: RecallDashboardModel }) {
  const { workspaceUnlocked, accountStatus, erased, stale, reviewSaving, reviewSaveFailed } = model;
  return (
    <Sidebar>
      <SidebarHeader className="flex-row flex-wrap items-center gap-2 px-3 py-4">
        <button
          type="button"
          aria-label="Recall home"
          onClick={() => {
            model.setActiveView(DashboardView.Today);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left focus-visible:outline-2 focus-visible:outline-primary"
        >
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary font-serif text-xl font-bold text-primary-foreground">
            r
          </span>
          <span className="text-xl font-bold tracking-tight group-data-[state=collapsed]/sidebar:hidden">
            recall.
          </span>
        </button>
        <SidebarTrigger className="size-8 shrink-0" aria-label="Collapse sidebar" />
      </SidebarHeader>
      <RecallDashboardNavigation model={model} />
      <SidebarFooter>
        {(workspaceUnlocked || accountStatus === "signed-in") && (
          <RecallDashboardSyncRecovery model={model} />
        )}
        {(erased || stale || reviewSaving || reviewSaveFailed) && (
          <div role="status">
            <i />{" "}
            {erased || stale
              ? "Read-only in this tab"
              : reviewSaving
                ? "Saving review…"
                : "Review save needs retry"}
          </div>
        )}
        <RecallDashboardSidebarMenu model={model} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
