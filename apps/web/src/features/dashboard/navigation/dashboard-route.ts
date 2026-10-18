import { Effect, Option } from "effect";
import { DashboardView, dashboardViewFromPath } from "./dashboard-navigation";
export type DashboardActivity = "materials" | "import" | "flagged";
export type DashboardRoute = {
  readonly view: DashboardView;
  readonly areaId?: string;
  readonly practiceId?: string;
  readonly activity?: DashboardActivity;
  readonly learningId?: string;
};
export function dashboardRouteHref(route: DashboardRoute): string {
  const query = new URLSearchParams();
  if (route.areaId) query.set("area", route.areaId);
  if (route.practiceId) {
    query.set("mode", "review");
    query.set("area", route.practiceId);
  } else if (route.view === DashboardView.Library) query.set("mode", "overview");
  else if (route.view === DashboardView.Tutor) query.set("mode", "tutor");
  else if (route.view === DashboardView.Improve) query.set("mode", "improve");
  if (route.activity) query.set("activity", route.activity);
  if (route.learningId) query.set("learning", route.learningId);
  const path = route.view === DashboardView.Insights ? "/insights" : "/subjects";
  return `${path}${query.size ? `?${query.toString()}` : ""}`;
}
export function parseDashboardRoute(path: string): DashboardRoute {
  const [pathname = "", search = ""] = path.split("?");
  const query = new URLSearchParams(search);
  const area = query.get("area");
  const activity = query.get("activity");
  const practice = pathname.startsWith("/practice/")
    ? Option.getOrNull(
        Effect.runSync(Effect.option(Effect.try(() => decodeURIComponent(pathname.slice(10))))),
      )
    : query.get("mode") === "review"
      ? area
      : null;
  const learning = query.get("learning");
  return {
    view: dashboardViewFromPath(path),
    ...(area ? { areaId: area } : {}),
    ...(practice ? { practiceId: practice } : {}),
    ...(activity === "materials" || activity === "import" || activity === "flagged"
      ? { activity }
      : {}),
    ...(learning ? { learningId: learning } : {}),
  };
}
