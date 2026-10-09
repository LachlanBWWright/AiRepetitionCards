import { NextDashboardPage } from "@/features/dashboard/NextDashboardRoutes";
import { DashboardView } from "@/features/dashboard/dashboard-navigation";

export default function InsightsPage() {
  return <NextDashboardPage routeView={DashboardView.Insights} />;
}
