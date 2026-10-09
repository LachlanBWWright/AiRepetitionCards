import { useCallback, useEffect, useState } from "react";
import RecallDashboard from "@/features/dashboard/RecallDashboard";
import {
  dashboardViewFromPath,
  dashboardViewPaths,
  type DashboardView,
} from "@/features/dashboard/dashboard-navigation";

function currentView(): DashboardView {
  return dashboardViewFromPath(window.location.hash.slice(1));
}

export default function DesktopDashboardRoutes() {
  const [routeView, setRouteView] = useState<DashboardView>(currentView);

  useEffect(() => {
    const syncRoute = () => {
      const view = currentView();
      const target = `#${dashboardViewPaths[view]}`;
      if (window.location.hash !== target) window.history.replaceState(null, "", target);
      setRouteView(view);
    };
    syncRoute();
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  const navigate = useCallback((view: DashboardView) => {
    const target = `#${dashboardViewPaths[view]}`;
    if (window.location.hash !== target) window.location.hash = target;
  }, []);

  return <RecallDashboard routeView={routeView} onViewChange={navigate} />;
}
