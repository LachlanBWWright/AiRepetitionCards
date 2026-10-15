"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import RecallDashboard from "@/features/dashboard/RecallDashboard";
import { dashboardViewPaths, type DashboardView } from "@/features/dashboard/dashboard-navigation";
import { ServiceWorkerRegistration } from "../../../pwa/service-worker-registration";

export function NextDashboardPage({
  routeView,
  practiceId,
  initialAreaId,
  initialActivityId,
  initialTutorActivity,
  initialImport,
  initialFlaggedOnly,
}: {
  readonly routeView: DashboardView;
  readonly practiceId?: string;
  readonly initialAreaId?: string;
  readonly initialActivityId?: string;
  readonly initialTutorActivity?: "materials";
  readonly initialImport?: boolean;
  readonly initialFlaggedOnly?: boolean;
}) {
  const router = useRouter();
  const navigate = useCallback(
    (view: DashboardView, areaId?: string, activity?: "materials" | "import" | "flagged") => {
      const query = new URLSearchParams();
      if (areaId) query.set("area", areaId);
      if (activity) query.set("activity", activity);
      router.push(
        `${dashboardViewPaths[view]}${query.size ? `?${query.toString()}` : ""}` as Route,
      );
    },
    [router],
  );
  const navigateToPractice = useCallback(
    (id: string) => router.push(`/practice/${encodeURIComponent(id)}` as Route),
    [router],
  );

  const navigateToDeckPage = useCallback(
    (deckId?: string, token?: string) => {
      const suffix = token ? `?${new URLSearchParams({ token }).toString()}` : "";
      router.push((deckId ? `/decks/${encodeURIComponent(deckId)}${suffix}` : "/decks") as Route);
    },
    [router],
  );

  const navigateToActivity = useCallback(
    (areaId: string, activityId: string) => {
      const query = new URLSearchParams({ area: areaId, learning: activityId });
      router.push(`/library?${query.toString()}` as Route);
    },
    [router],
  );

  return (
    <>
      <ServiceWorkerRegistration />
      <RecallDashboard
        key={`${initialActivityId ?? ""}:${routeView}:${practiceId ?? ""}:${initialAreaId ?? ""}:${initialTutorActivity ?? ""}:${String(initialImport ?? false)}:${String(initialFlaggedOnly ?? false)}`}
        routeView={routeView}
        {...(initialImport ? { initialImport } : {})}
        {...(initialFlaggedOnly ? { initialFlaggedOnly } : {})}
        {...(initialAreaId ? { initialAreaId } : {})}
        {...(initialActivityId ? { initialActivityId } : {})}
        onActivityChange={navigateToActivity}
        onOpenDeckPage={navigateToDeckPage}
        {...(initialTutorActivity ? { initialTutorActivity } : {})}
        onViewChange={navigate}
        {...(practiceId ? { practiceId } : {})}
        onPracticeChange={navigateToPractice}
      />
    </>
  );
}
