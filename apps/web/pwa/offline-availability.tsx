"use client";

import { useEffect, useRef, useState } from "react";
import { Effect, Either } from "effect";
import { Button } from "@/components/ui/Button";

type InstallPrompt = Event & { readonly prompt: () => Promise<void> };
function isInstallPrompt(event: Event): event is InstallPrompt {
  return "prompt" in event && typeof event.prompt === "function";
}
const base = process.env.NEXT_PUBLIC_RECALL_ASSET_BASE ?? "/";
export function OfflineAvailability() {
  const [status, setStatus] = useState("Preparing offline availability…");
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [installing, setInstalling] = useState(false);
  const requestedUpdate = useRef(false);
  useEffect(() => {
    let mounted = true;
    const publish = (message: string) => {
      if (mounted) setStatus(message);
    };
    const install = (event: Event) => {
      if (!isInstallPrompt(event)) return;
      event.preventDefault();
      setInstallPrompt(event);
    };
    const installed = () => {
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", install);
    window.addEventListener("appinstalled", installed);
    const cleanups: (() => void)[] = [];
    if (!("serviceWorker" in navigator) || !window.isSecureContext) {
      publish("Local study is available. Offline installation needs HTTPS or localhost.");
    } else if (process.env.NODE_ENV === "development") {
      publish("Local development preview. The production app supports offline installation.");
    } else {
      const controllerChanged = () => {
        if (requestedUpdate.current) window.location.reload();
      };
      navigator.serviceWorker.addEventListener("controllerchange", controllerChanged);
      cleanups.push(() => {
        navigator.serviceWorker.removeEventListener("controllerchange", controllerChanged);
      });
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
      ).then((result) => {
        if (!mounted) return;
        if (Either.isLeft(result)) {
          publish(
            "Offline installation could not finish. Reopen this page online to retry; local cards remain saved.",
          );
          return;
        }
        const registration = result.right;
        const inspect = () => {
          if (!mounted) return;
          if (registration.waiting) setWaiting(registration.waiting);
          const worker = registration.installing;
          if (!worker) return;
          const changed = () => {
            if (worker.state === "installed") {
              if (registration.waiting && navigator.serviceWorker.controller)
                setWaiting(registration.waiting);
              else publish("Ready for offline study on this device.");
            }
            if (worker.state === "redundant")
              publish(
                "The offline update could not finish. Reopen online to retry; local cards remain saved.",
              );
          };
          worker.addEventListener("statechange", changed);
          cleanups.push(() => {
            worker.removeEventListener("statechange", changed);
          });
          changed();
        };
        registration.addEventListener("updatefound", inspect);
        cleanups.push(() => {
          registration.removeEventListener("updatefound", inspect);
        });
        inspect();
        if (registration.active) publish("Ready for offline study on this device.");
      });
    }
    return () => {
      mounted = false;
      window.removeEventListener("beforeinstallprompt", install);
      window.removeEventListener("appinstalled", installed);
      for (const cleanup of cleanups) cleanup();
    };
  }, []);
  async function install() {
    if (!installPrompt || installing) return;
    setInstalling(true);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => installPrompt.prompt(),
          catch: () => ({ _tag: "OfflineInstallPromptUnavailable" }) as const,
        }),
      ),
    );
    setInstallPrompt(null);
    setInstalling(false);
    if (Either.isLeft(result))
      setStatus("Use your browser's install or Add to Home Screen action to install Recall.");
  }
  return (
    <aside
      aria-label="Offline application"
      style={{
        padding: "12px 24px",
        background: "#e8eee6",
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <span role="status">{status}</span>
      {installPrompt ? (
        <Button size="small" disabled={installing} onClick={() => void install()}>
          Install Recall
        </Button>
      ) : (
        <span>Install using your browser&apos;s app or Add to Home Screen menu.</span>
      )}
      {waiting && (
        <Button
          size="small"
          onClick={() => {
            if (
              !window.confirm(
                "Apply the app update and reload? Save any open drafts first. Saved cards and reviews stay on this device.",
              )
            )
              return;
            requestedUpdate.current = true;
            waiting.postMessage({ type: "ACTIVATE_UPDATE" });
          }}
        >
          Update app
        </Button>
      )}
    </aside>
  );
}
