import { NextDashboardPage } from "@/features/dashboard/navigation/NextDashboardRoutes";
import { DashboardView } from "@/features/dashboard/navigation/dashboard-navigation";

export default function TodayPage() {
  return <NextDashboardPage routeView={DashboardView.Today} />;
}
