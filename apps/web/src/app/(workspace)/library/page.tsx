import { NextDashboardPage } from "@/features/dashboard/NextDashboardRoutes";
import { DashboardView } from "@/features/dashboard/dashboard-navigation";

export default function LibraryPage() {
  return <NextDashboardPage routeView={DashboardView.Library} />;
}
