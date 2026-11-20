"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Effect } from "effect";
import { useAiFunding, type AiFundingPorts } from "@recall/react";
import { decodeManagedAiStatus } from "@recall/application";
import { apiFetch } from "@/lib/desktop-api";
import { readBrowserSession } from "@/lib/auth/browser-session";
import { readFundingPreference, writeFundingPreference } from "@/lib/ai/browser-funding-preference";

const ports: AiFundingPorts = {
  read: readFundingPreference,
  write: writeFundingPreference,
  status: (owner) =>
    Effect.tryPromise({
      try: async (): Promise<unknown> => {
        const response = await apiFetch("/api/v1/ai/capabilities", { cache: "no-store" });
        return response.ok ? ((await response.json()) as unknown) : null;
      },
      catch: () => ({ message: "Managed AI access could not be checked." }),
    }).pipe(Effect.flatMap((raw) => decodeManagedAiStatus(raw, owner))),
};
const Context = createContext<ReturnType<typeof useAiFunding> | null>(null);
export function AiFundingProvider({ children }: { readonly children: ReactNode }) {
  const [owner, setOwner] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let sequence = 0;
    const refresh = () => {
      const revision = ++sequence;
      Effect.runFork(
        readBrowserSession().pipe(
          Effect.match({
            onFailure: () => {
              if (alive && revision === sequence) setOwner(null);
            },
            onSuccess: (session) => {
              if (alive && revision === sequence) setOwner(session.ownerId);
            },
          }),
        ),
      );
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const funding = useAiFunding(owner, ports);
  return <Context.Provider value={funding}>{children}</Context.Provider>;
}
export const useBrowserAiFunding = () => useContext(Context);
