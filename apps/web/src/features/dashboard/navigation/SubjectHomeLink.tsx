import type { ReactNode } from "react";
import { NavigationLink } from "@recall/ui-web";
import { DashboardView, dashboardViewPaths } from "./dashboard-navigation";

export function SubjectHomeLink({
  children = "Home / Subjects",
  onNavigate,
}: {
  readonly children?: ReactNode;
  readonly onNavigate: () => void;
}) {
  return (
    <NavigationLink href={dashboardViewPaths[DashboardView.Today]} onNavigate={onNavigate}>
      {children}
    </NavigationLink>
  );
}
