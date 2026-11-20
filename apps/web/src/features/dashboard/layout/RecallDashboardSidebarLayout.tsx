import { useState } from "react";
import { Cloud, TriangleAlert } from "lucide-react";
import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarMenuButton,
  useSidebar,
  SidebarTrigger,
} from "@recall/ui-web/components/sidebar";
import { DashboardView } from "../navigation/dashboard-navigation";
import { RecallDashboardNavigation } from "../navigation/RecallDashboardNavigation";
import { RecallDashboardSyncRecovery } from "../storage/RecallDashboardSyncRecovery";
import { RecallDashboardSidebarMenu } from "./RecallDashboardSidebarMenu";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
export function RecallDashboardSidebarLayout({ model }: { readonly model: RecallDashboardModel }) {
  const { setOpen } = useSidebar();
  const [showSignInHint, setShowSignInHint] = useState(false);
  const { workspaceUnlocked, accountStatus, erased, stale, reviewSaving, reviewSaveFailed } = model;
  const attention =
    erased || stale
      ? "Read-only in this tab"
      : reviewSaving
        ? "Saving review…"
        : reviewSaveFailed
          ? "Review save needs retry"
          : null;
  return (
    <Sidebar>
      <SidebarHeader className="flex-row items-center gap-2 px-3 py-4 group-data-[state=collapsed]/sidebar:flex-col group-data-[state=collapsed]/sidebar:px-2">
        <SidebarMenuButton
          tooltip="Recall home"
          type="button"
          aria-label="Recall home"
          onClick={() => {
            model.setActiveView(DashboardView.Today);
          }}
          className="min-w-0 flex-1 gap-2 group-data-[state=collapsed]/sidebar:flex-none"
        >
          <span className="text-xl inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary font-serif font-bold text-white">
            r
          </span>
          <span className="text-xl font-bold tracking-tight group-data-[state=collapsed]/sidebar:hidden">
            recall.
          </span>
        </SidebarMenuButton>
        <SidebarTrigger className="size-10 shrink-0" />
      </SidebarHeader>
      <RecallDashboardNavigation model={model} />
      <SidebarFooter>
        {(workspaceUnlocked || accountStatus === "signed-in") && (
          <>
            <div className="group-data-[state=collapsed]/sidebar:hidden">
              <RecallDashboardSyncRecovery model={model} onSignInHintChange={setShowSignInHint} />
            </div>
            <SidebarMenuButton
              tooltip="Sync status"
              className="hidden group-data-[state=collapsed]/sidebar:flex"
              onClick={() => {
                setOpen(true);
              }}
            >
              <Cloud aria-hidden="true" />
            </SidebarMenuButton>
          </>
        )}
        {attention && (
          <div role="status" className="group-data-[state=collapsed]/sidebar:hidden">
            {attention}
          </div>
        )}
        {attention && (
          <SidebarMenuButton
            tooltip={attention}
            className="hidden group-data-[state=collapsed]/sidebar:flex"
            onClick={() => {
              setOpen(true);
            }}
          >
            <TriangleAlert aria-hidden="true" />
          </SidebarMenuButton>
        )}
        <RecallDashboardSidebarMenu
          model={model}
          showSignInHint={showSignInHint || accountStatus === "signed-out"}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
