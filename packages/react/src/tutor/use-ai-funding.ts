import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Effect } from "effect";
import {
  createAiFundingStore,
  managedAiUnavailableReason,
  type AiFundingPorts,
  type AiAccessSelection,
} from "@recall/application";
export type { AiFundingPorts } from "@recall/application";

/** React owns subscriptions only; account lifetime, ordering and failure policy live in application. */
export function useAiFunding(owner: string | null, ports: AiFundingPorts) {
  const store = useMemo(() => createAiFundingStore(owner, ports), [owner, ports]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    Effect.runFork(store.initialize);
    return store.dispose;
  }, [store]);
  return {
    ...snapshot,
    select: (mode: AiAccessSelection) => {
      Effect.runFork(store.select(mode));
    },
    refresh: () => {
      Effect.runFork(store.refresh());
    },
    unavailableReason: managedAiUnavailableReason(snapshot),
  };
}
