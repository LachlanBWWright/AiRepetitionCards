import { NextDashboardPage } from "@/features/dashboard/NextDashboardRoutes";
import { DashboardView } from "@/features/dashboard/dashboard-navigation";

export default async function TutorPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}) {
  const query = await searchParams;
  return (
    <NextDashboardPage
      routeView={DashboardView.Tutor}
      {...(typeof query.area === "string" ? { initialAreaId: query.area } : {})}
      {...(query.activity === "materials" ? { initialTutorActivity: "materials" as const } : {})}
    />
  );
}
