import { NextDashboardPage } from "@/features/dashboard/navigation/NextDashboardRoutes";
import { parseDashboardRoute } from "@/features/dashboard/navigation/dashboard-route";
export default async function SubjectsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}) {
  const raw = await searchParams;
  const query = new URLSearchParams(
    Object.entries(raw).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  );
  const route = parseDashboardRoute(`/subjects?${query.toString()}`);
  return (
    <NextDashboardPage
      routeView={route.view}
      {...(route.areaId ? { initialAreaId: route.areaId } : {})}
      {...(route.practiceId ? { practiceId: route.practiceId } : {})}
      {...(route.learningId ? { initialActivityId: route.learningId } : {})}
      initialImport={route.activity === "import"}
      initialFlaggedOnly={route.activity === "flagged"}
      {...(route.activity === "materials" ? { initialTutorActivity: "materials" } : {})}
    />
  );
}
