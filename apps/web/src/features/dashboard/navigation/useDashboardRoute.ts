import { useCallback, useEffect, useState } from "react";
import { dashboardRouteHref, parseDashboardRoute, type DashboardRoute } from "./dashboard-route";

export function useDashboardRoute(initial: DashboardRoute, hash = false) {
  const [route, setRoute] = useState(initial);
  useEffect(() => {
    const sync = () => {
      setRoute(
        parseDashboardRoute(
          hash
            ? window.location.hash.slice(1)
            : `${window.location.pathname}${window.location.search}`,
        ),
      );
    };
    window.addEventListener(hash ? "hashchange" : "popstate", sync);
    return () => {
      window.removeEventListener(hash ? "hashchange" : "popstate", sync);
    };
  }, [hash]);
  const navigate = useCallback(
    (next: DashboardRoute) => {
      const href = dashboardRouteHref(next);
      window.history.pushState(null, "", hash ? `#${href}` : href);
      setRoute(next);
    },
    [hash],
  );
  return { route, navigate };
}
