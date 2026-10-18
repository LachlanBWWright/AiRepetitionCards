import { useCallback, useEffect, useRef } from "react";
import { Effect, Either } from "effect";
import type { ActivityLibrary } from "@recall/domain";
import { mergeActivityLibraries, type ActivityServices } from "@recall/application";
import { readRef } from "../read-ref";

export function useLearningActivitiesPersistence({
  library,
  services,
  onSave,
  setMessage,
  setSyncStatus,
}: {
  readonly library: ActivityLibrary;
  readonly services: ActivityServices | undefined;
  readonly onSave: (library: ActivityLibrary) => Promise<boolean>;
  readonly setMessage: (message: string | null) => void;
  readonly setSyncStatus: (
    status: "saved-locally" | "synchronized" | "awaiting-sync" | "conflicted",
  ) => void;
}) {
  const alive = useRef(true);
  const saveCallback = useRef(onSave);
  const latestLibrary = useRef(library);
  const saveLane = useRef<Promise<boolean>>(Promise.resolve(true));

  useEffect(() => {
    saveCallback.current = onSave;
  }, [onSave]);

  useEffect(() => {
    latestLibrary.current = library;
  }, [library]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const persist = useCallback(
    async (next: ActivityLibrary, synchronized = false) => {
      const queued = saveLane.current.then(async () => {
        if (!alive.current) return false;
        const saved = await Effect.runPromise(
          Effect.either(
            Effect.tryPromise({
              try: () => saveCallback.current(next),
              catch: () => ({ message: "Save not confirmed." }),
            }),
          ),
        );
        const confirmed = Either.isRight(saved) && saved.right;
        if (confirmed) {
          latestLibrary.current = next;
          setSyncStatus(
            services ? (synchronized ? "synchronized" : "awaiting-sync") : "saved-locally",
          );
        } else setSyncStatus("conflicted");
        return confirmed;
      });
      saveLane.current = queued;
      return queued;
    },
    [services, setSyncStatus],
  );

  useEffect(() => {
    if (!services) return;
    let cancelled = false;
    void Effect.runPromise(
      Effect.either(
        services.read.pipe(
          Effect.flatMap((remote) => mergeActivityLibraries(latestLibrary.current, remote)),
        ),
      ),
    ).then(async (result) => {
      if (!alive.current || cancelled) return;
      if (Either.isLeft(result)) {
        setMessage(result.left.message);
        return;
      }
      const saved = await persist(result.right, true);
      if (readRef(alive) && !saved)
        setMessage(
          "Account activities loaded, but the local save was not confirmed. Retry synchronization.",
        );
    });
    return () => {
      cancelled = true;
    };
  }, [services, persist, setMessage]);

  return { alive, persist };
}
