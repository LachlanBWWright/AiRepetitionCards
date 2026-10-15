import { NextDashboardPage } from "@/features/dashboard/NextDashboardRoutes";
import { DashboardView } from "@/features/dashboard/dashboard-navigation";

export default async function LibraryPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}) {
  const query = await searchParams;
  return (
    <NextDashboardPage
      routeView={DashboardView.Library}
      initialImport={query.activity === "import"}
      initialFlaggedOnly={query.activity === "flagged"}
      {...(typeof query.learning === "string" &&
      query.learning.length > 0 &&
      query.learning.length <= 200
        ? { initialActivityId: query.learning }
        : {})}
      {...(typeof query.area === "string" ? { initialAreaId: query.area } : {})}
      {...(query.activity === "materials" ? { initialTutorActivity: "materials" as const } : {})}
    />
  );
}
