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
}: {
  readonly routeView: DashboardView;
  readonly practiceId?: string;
}) {
  const router = useRouter();
  const navigate = useCallback(
    (view: DashboardView) => router.push(dashboardViewPaths[view] as Route),
    [router],
  );
  const navigateToPractice = useCallback(
    (id: string) => router.push(`/practice/${encodeURIComponent(id)}` as Route),
    [router],
  );

  return (
    <>
      <ServiceWorkerRegistration />
      <RecallDashboard
        routeView={routeView}
        onViewChange={navigate}
        {...(practiceId ? { practiceId } : {})}
        onPracticeChange={navigateToPractice}
      />
    </>
  );
}
