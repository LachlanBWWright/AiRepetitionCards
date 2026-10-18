import assert from "node:assert/strict";
import test from "node:test";
import { DashboardView } from "../../../../apps/web/src/features/dashboard/navigation/dashboard-navigation";
import {
  dashboardRouteHref,
  parseDashboardRoute,
  type DashboardRoute,
} from "../../../../apps/web/src/features/dashboard/navigation/dashboard-route";
void test("subject activity routes round-trip area, mode and material context for web and desktop", () => {
  const routes: readonly DashboardRoute[] = [
    { view: DashboardView.Today },
    { view: DashboardView.Library, areaId: "Cell biology / α" },
    { view: DashboardView.Tutor, areaId: "biology" },
    { view: DashboardView.Improve, areaId: "biology", activity: "materials" },
    { view: DashboardView.Today, areaId: "all", practiceId: "all" },
    { view: DashboardView.Library, areaId: "biology", learningId: "activity-1" },
  ];
  for (const route of routes)
    assert.deepEqual(parseDashboardRoute(dashboardRouteHref(route)), route);
});
void test("legacy links retain their selected subject and review identity", () => {
  assert.equal(parseDashboardRoute("/today").view, DashboardView.Today);
  assert.equal(parseDashboardRoute("/library?area=biology").areaId, "biology");
  assert.equal(parseDashboardRoute("/tutor?area=biology").view, DashboardView.Tutor);
  assert.equal(parseDashboardRoute("/practice/Cell%20biology").practiceId, "Cell biology");
});

void test("malformed legacy route encoding is ignored safely", () => {
  assert.equal(parseDashboardRoute("/practice/%ZZ").practiceId, undefined);
});
