import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { reviewerTimedAction } from "@recall/application";
import type { ReviewerAction, ReviewerSettings } from "@recall/domain";

type Props = {
  readonly cardId: string | undefined;
  readonly revealed: boolean;
  readonly active: boolean;
  readonly settings: ReviewerSettings;
  readonly now: () => number;
  readonly onAction: (action: ReviewerAction) => void;
};

/** Auto-advance always starts with an explicit action, and pauses with its host. */
export function useReviewerControls({ cardId, revealed, active, settings, now, onAction }: Props) {
  const [running, setRunning] = useState(false);
  const [display, setDisplay] = useState({ key: "", elapsed: 0 });
  const phase = `${cardId ?? ""}:${String(revealed)}`;
  const timer = useRef({ key: "", elapsed: 0, fired: false });
  const callback = useRef({ phase, active, onAction });
  useLayoutEffect(() => {
    callback.current = { phase, active, onAction };
  }, [phase, active, onAction]);
  useEffect(() => {
    if (!active || !cardId || (!settings.showTimer && !running)) return;
    if (timer.current.key !== phase) timer.current = { key: phase, elapsed: 0, fired: false };
    let last = now();
    const interval = setInterval(() => {
      // A host can commit a replacement card before the old passive interval cleans up.
      if (callback.current.phase !== phase || !callback.current.active) return;
      const at = now();
      timer.current.elapsed += Math.max(0, at - last);
      last = at;
      setDisplay({ key: phase, elapsed: timer.current.elapsed });
      const action = reviewerTimedAction(timer.current.elapsed, revealed, settings);
      if (running && action && !timer.current.fired) {
        timer.current.fired = true;
        callback.current.onAction(action);
      }
    }, 250);
    return () => {
      clearInterval(interval);
    };
  }, [active, cardId, now, phase, revealed, running, settings]);
  return {
    running,
    elapsedSeconds: display.key === phase ? Math.floor(display.elapsed / 1000) : 0,
    canAutoAdvance: settings.questionSeconds > 0 || settings.answerSeconds > 0,
    toggle: () => {
      timer.current = { key: phase, elapsed: 0, fired: false };
      setDisplay({ key: phase, elapsed: 0 });
      setRunning((value) => !value);
    },
  };
}
