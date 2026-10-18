import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@recall/ui-web/components/dropdown-menu";
import { DashboardView } from "../navigation/dashboard-navigation";
import { isDesktopRuntime } from "@/lib/desktop-api";
import { ChevronDown, Settings2, LogOut, UserRound } from "lucide-react";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@recall/ui-web/components/sidebar";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";

function SignOutMenuItem() {
  return (
    <>
      <DropdownMenuSeparator />
      <form action="/auth/sign-out" method="post">
        <DropdownMenuItem asChild>
          <button type="submit" className="w-full">
            <LogOut aria-hidden="true" />
            Sign out
          </button>
        </DropdownMenuItem>
      </form>
    </>
  );
}

export function RecallDashboardSidebarMenu({ model }: { readonly model: RecallDashboardModel }) {
  const {
    accountPanelOpen,
    setAccountPanelOpen,
    accountMenuTrigger,
    accountSettingsOpen,
    deviceSettings,
    importExportOpen,
    setLibraryTools,
    setImportExportOpen,
    setAccountSettingsOpen,
    setDeviceSettings,
    demo,
    accountStatus,
  } = model;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={accountPanelOpen} onOpenChange={setAccountPanelOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              ref={accountMenuTrigger}
              keepMobileOpen
              tooltip="Account"
              isActive={accountPanelOpen}
              aria-expanded={accountPanelOpen}
            >
              <UserRound aria-hidden="true" />
              <span className="group-data-[state=collapsed]/sidebar:hidden flex min-w-0 flex-1 flex-col gap-0.5">
                <strong>Account</strong>
              </span>
              <ChevronDown
                className="group-data-[state=collapsed]/sidebar:hidden ml-auto text-[var(--muted)]"
                aria-hidden="true"
              />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="end"
            sideOffset={8}
            className="w-56 max-w-[calc(100vw-1rem)]"
            onCloseAutoFocus={(event) => {
              if (accountSettingsOpen || deviceSettings || importExportOpen) event.preventDefault();
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                model.setActiveView(DashboardView.Insights);
              }}
            >
              Workspace data and review settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setLibraryTools("backup");
                setImportExportOpen(true);
              }}
            >
              Workspace backup
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setAccountSettingsOpen(true);
              }}
            >
              <UserRound aria-hidden="true" />
              Account settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setDeviceSettings(true);
              }}
            >
              <Settings2 aria-hidden="true" className="size-4" />
              Device settings
            </DropdownMenuItem>
            {!demo && !isDesktopRuntime() && accountStatus === "signed-in" && <SignOutMenuItem />}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
