import { NextDashboardPage } from "@/features/dashboard/NextDashboardRoutes";
import { DashboardView } from "@/features/dashboard/dashboard-navigation";

export default function TutorPage() {
  return <NextDashboardPage routeView={DashboardView.Tutor} />;
}
