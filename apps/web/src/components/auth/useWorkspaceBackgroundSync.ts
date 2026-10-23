"use client";

import { useEffect, useRef } from "react";

/** Local changes debounce; remote changes arrive on resume, reconnect and periodic pulls. */
export function useWorkspaceBackgroundSync({
  enabled,
  revision,
  retrySignal,
  lastSyncedWorkspace,
  sync,
}: {
  readonly enabled: boolean;
  readonly revision: unknown;
  readonly retrySignal: number;
  readonly lastSyncedWorkspace: { current: string | null };
  readonly sync: () => void;
}) {
  const syncRef = useRef(sync);
  useEffect(() => {
    syncRef.current = sync;
  });
  useEffect(() => {
    if (!enabled || lastSyncedWorkspace.current === JSON.stringify(revision)) return;
    const timer = window.setTimeout(() => {
      syncRef.current();
    }, 400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [enabled, revision, retrySignal, lastSyncedWorkspace]);
  useEffect(() => {
    if (!enabled) return;
    const resume = () => {
      if (document.visibilityState === "hidden" || !navigator.onLine) return;
      lastSyncedWorkspace.current = null;
      syncRef.current();
    };
    const timer = window.setInterval(resume, 30_000);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [enabled, lastSyncedWorkspace]);
}
