"use client";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import RecallDashboard from "../RecallDashboard";
import type { RecallDashboardProps } from "../RecallDashboardProps";
import { DashboardView } from "./dashboard-navigation";
import { useDashboardRoute } from "./useDashboardRoute";
import { ServiceWorkerRegistration } from "../../../../pwa/service-worker-registration";

export function NextDashboardPage(
  props: Omit<RecallDashboardProps, "routeView"> & { readonly routeView: DashboardView },
) {
  const router = useRouter();
  const { route, navigate } = useDashboardRoute({
    view: props.initialTutorActivity ? DashboardView.Improve : props.routeView,
    ...(props.initialAreaId ? { areaId: props.initialAreaId } : {}),
    ...(props.practiceId ? { practiceId: props.practiceId } : {}),
    ...(props.initialActivityId ? { learningId: props.initialActivityId } : {}),
    ...(props.initialTutorActivity ? { activity: props.initialTutorActivity } : {}),
  });
  return (
    <>
      <ServiceWorkerRegistration />
      <RecallDashboard
        {...props}
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
        onOpenDeckPage={(deckId, token) => {
          const suffix = token ? `?${new URLSearchParams({ token }).toString()}` : "";
          router.push(
            (deckId ? `/decks/${encodeURIComponent(deckId)}${suffix}` : "/decks") as Route,
          );
        }}
      />
    </>
  );
}
