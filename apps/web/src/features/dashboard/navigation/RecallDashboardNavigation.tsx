import { Home, Plus } from "lucide-react";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarMenuItem,
} from "@recall/ui-web/components/sidebar";
import { DashboardView } from "./dashboard-navigation";
import { dueNow } from "../layout/RecallDashboardSupport";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
export function RecallDashboardNavigation({ model }: { readonly model: RecallDashboardModel }) {
  const disabled = model.reviewSaving || model.reviewSaveFailed;
  return (
    <SidebarContent className="gap-0 pt-1">
      <SidebarGroup>
        <SidebarMenu aria-label="Main navigation">
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={model.activeView === DashboardView.Today && !model.practiceId}
              tooltip="Home"
              onClick={() => {
                model.setActiveView(DashboardView.Today);
              }}
            >
              <Home aria-hidden="true" />
              <span>Home</span>
              {model.workspaceUnlocked && <SidebarMenuBadge>{model.dueCount}</SidebarMenuBadge>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      {model.workspaceUnlocked && (
        <SidebarGroup>
          <SidebarGroupLabel>
            <span className="group-data-[state=collapsed]/sidebar:hidden">Your subjects</span>
            <SidebarGroupAction
              aria-label="New subject"
              onClick={model.addArea}
              disabled={disabled}
            >
              <Plus aria-hidden="true" />
            </SidebarGroupAction>
          </SidebarGroupLabel>
          <SubjectNavigationMenu model={model} />
        </SidebarGroup>
      )}
    </SidebarContent>
  );
}

function SubjectNavigationMenu({ model }: { readonly model: RecallDashboardModel }) {
  return (
    <SidebarMenu>
      {model.workspace.areas.map((area) => (
        <SubjectNavigationRow key={area.id} model={model} area={area} />
      ))}
    </SidebarMenu>
  );
}
function SubjectNavigationRow({
  model,
  area,
}: {
  readonly model: RecallDashboardModel;
  readonly area: RecallDashboardModel["workspace"]["areas"][number];
}) {
  const active =
    model.selectedId === area.id &&
    !(model.activeView === DashboardView.Today && !model.practiceId);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={area.title}
        isActive={active}
        disabled={model.reviewSaving || model.reviewSaveFailed}
        onClick={() => {
          model.openSubject(area.id, "overview");
        }}
      >
        <span
          aria-hidden="true"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-background"
          style={{ backgroundColor: area.color }}
        >
          {area.cards.filter((card) => dueNow(card, model.now)).length}
        </span>
        <span className="truncate group-data-[state=collapsed]/sidebar:hidden">{area.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
