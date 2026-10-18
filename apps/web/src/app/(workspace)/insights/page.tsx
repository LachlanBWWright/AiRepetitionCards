import { NextDashboardPage } from "@/features/dashboard/navigation/NextDashboardRoutes";
import { DashboardView } from "@/features/dashboard/navigation/dashboard-navigation";

export default function InsightsPage() {
  return <NextDashboardPage routeView={DashboardView.Insights} />;
}
