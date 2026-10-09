"use client";

import { useEffect } from "react";
import { Effect } from "effect";

const base = process.env.NEXT_PUBLIC_RECALL_ASSET_BASE ?? "/";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    const suppressAutomaticInstallPrompt = (event: Event) => {
      if ("prompt" in event && typeof event.prompt === "function") event.preventDefault();
    };
    window.addEventListener("beforeinstallprompt", suppressAutomaticInstallPrompt);

    if (
      "serviceWorker" in navigator &&
      window.isSecureContext &&
      process.env.NODE_ENV !== "development"
    ) {
      void Effect.runPromise(
        Effect.either(
          Effect.tryPromise({
            try: () =>
              navigator.serviceWorker.register(`${base}service-worker.js`, {
                scope: base,
                updateViaCache: "none",
              }),
            catch: () => ({ _tag: "OfflineRegistrationUnavailable" }) as const,
          }),
        ),
      );
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", suppressAutomaticInstallPrompt);
    };
  }, []);

  return null;
}
