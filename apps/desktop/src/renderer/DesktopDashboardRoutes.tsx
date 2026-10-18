import RecallDashboard from "@/features/dashboard/RecallDashboard";
import { DashboardView } from "@/features/dashboard/navigation/dashboard-navigation";
import { parseDashboardRoute } from "@/features/dashboard/navigation/dashboard-route";
import { useDashboardRoute } from "@/features/dashboard/navigation/useDashboardRoute";
export default function DesktopDashboardRoutes() {
  const { route, navigate } = useDashboardRoute(
    parseDashboardRoute(window.location.hash.slice(1)),
    true,
  );
  return (
    <RecallDashboard
      routeView={route.view}
      initialAreaId={route.areaId}
      practiceId={route.practiceId}
      initialActivityId={route.learningId}
      initialTutorActivity={route.activity === "materials" ? "materials" : undefined}
      onViewChange={(view, areaId, activity) => {
        navigate({ view, ...(areaId ? { areaId } : {}), ...(activity ? { activity } : {}) });
      }}
      onPracticeChange={(practiceId) => {
        navigate({ view: DashboardView.Today, areaId: practiceId, practiceId });
      }}
      onActivityChange={(areaId, learningId) => {
        navigate({ view: DashboardView.Library, areaId, learningId });
      }}
    />
  );
}
