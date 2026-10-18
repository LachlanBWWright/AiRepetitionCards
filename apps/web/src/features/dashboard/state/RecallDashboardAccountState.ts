import { useCallback, useEffect, useState } from "react";
import { Effect, Either } from "effect";
import { readBrowserSession } from "@/lib/auth/browser-session";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { isDesktopRuntime } from "@/lib/desktop-api";
import type { StoryDemo } from "@/features/dashboard/layout/RecallDashboardSupport";

export function useRecallDashboardAccountState(demo: StoryDemo | undefined) {
  const [cloudWorkspaceLoaded, setCloudWorkspaceLoaded] = useState(false);
  const [accountStatus, setAccountStatus] = useState<
    "checking" | "signed-in" | "signed-out" | "unavailable"
  >(demo || isDesktopRuntime() ? "signed-in" : "checking");

  const checkAccount = useCallback(() => {
    if (demo || isDesktopRuntime()) return;
    void Effect.runPromise(Effect.either(readBrowserSession())).then((result) => {
      if (Either.isLeft(result)) {
        setCloudWorkspaceLoaded(false);
        setAccountStatus("unavailable");
      } else {
        setAccountStatus(result.right.authenticated ? "signed-in" : "signed-out");
        if (!result.right.authenticated) setCloudWorkspaceLoaded(false);
      }
    });
  }, [demo]);

  useEffect(() => {
    checkAccount();
    const refresh = () => {
      checkAccount();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [checkAccount]);

  return {
    accountStatus,
    checkAccount,
    cloudWorkspaceLoaded,
    setAccountStatus,
    setCloudWorkspaceLoaded,
    webAccountConfigured: Either.isRight(readSupabaseConfig()),
    workspaceUnlocked:
      Boolean(demo) ||
      isDesktopRuntime() ||
      (accountStatus === "signed-in" && cloudWorkspaceLoaded),
  } as const;
}
