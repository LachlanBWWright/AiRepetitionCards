import { NextDashboardPage } from "@/features/dashboard/NextDashboardRoutes";
import { DashboardView } from "@/features/dashboard/dashboard-navigation";

export default async function PracticePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return <NextDashboardPage routeView={DashboardView.Today} practiceId={id} />;
}
