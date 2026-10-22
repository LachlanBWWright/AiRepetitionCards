import {
  createAreaId,
  reviewPlacement,
  effectiveReviewEvents,
  type SchedulerSettings,
  type Workspace,
} from "@recall/domain";
import { useEffect, useRef, useState } from "react";
import { Effect, Either } from "effect";
import { fitSchedulerParameters, type ParameterFitProposal } from "@recall/scheduler";

/** Shared cancelable fitting lifecycle for web, Electron and native settings. */
export function useParameterFitting(workspace: Workspace, settings: SchedulerSettings) {
  const [proposal, setProposal] = useState<ParameterFitProposal | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  const fit = () => {
    if (busy || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setProposal(null);
    setMessage("");
    const placement = reviewPlacement(workspace);
    const events = effectiveReviewEvents(workspace).map((event) => ({
      ...event,
      areaId: createAreaId(placement.areaId(event)),
    }));
    void Effect.runPromise(
      Effect.either(
        fitSchedulerParameters(events, settings.weights, {
          ...(settings.optimizationReviewedAfter
            ? { reviewedAfter: settings.optimizationReviewedAfter }
            : {}),
        }),
      ),
      {
        signal: abort.signal,
      },
    )
      .then((result) => {
        if (abort.signal.aborted) return;
        controller.current = null;
        setBusy(false);
        if (Either.isRight(result)) setProposal(result.right);
        else
          setMessage(
            result.left.reason === "insufficient-history"
              ? "At least 100 reviews separated by a day are needed. Keep reviewing, then try again."
              : "Fitting could not finish. Your current parameters are unchanged.",
          );
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          controller.current = null;
          setBusy(false);
          setMessage("Fitting could not finish. Try again.");
        }
      });
  };
  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setMessage("Fitting cancelled. Current parameters are unchanged.");
  };
  return { proposal, setProposal, message, setMessage, busy, fit, cancel };
}
