import { NextDashboardPage } from "@/features/dashboard/NextDashboardRoutes";
import { DashboardView } from "@/features/dashboard/dashboard-navigation";

export default function TodayPage() {
  return <NextDashboardPage routeView={DashboardView.Today} />;
}
