import type { ReviewerAction, ReviewerSettings } from "@recall/domain";

/** Input mapping never supplies a rating while the answer is hidden. */
export function reviewerKeyAction(
  key: string,
  revealed: boolean,
  settings: ReviewerSettings,
): ReviewerAction | undefined {
  if (
    !revealed &&
    (key === "Enter" || key.toLowerCase() === settings.shortcuts.reveal.toLowerCase())
  )
    return "reveal";
  if (!revealed) return undefined;
  return (["again", "hard", "good", "easy"] as const).find(
    (action) => settings.shortcuts[action].toLowerCase() === key.toLowerCase(),
  );
}

export function reviewerSwipeAction(
  dx: number,
  dy: number,
  revealed: boolean,
  settings: ReviewerSettings,
): ReviewerAction | undefined {
  if (!settings.swipeEnabled || Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 2)
    return undefined;
  const action = dx < 0 ? settings.swipeLeft : settings.swipeRight;
  return action === "reveal" ? (revealed ? undefined : action) : revealed ? action : undefined;
}

export function reviewerTimedAction(
  elapsedMs: number,
  revealed: boolean,
  settings: ReviewerSettings,
): ReviewerAction | undefined {
  const seconds = revealed ? settings.answerSeconds : settings.questionSeconds;
  if (seconds === 0 || elapsedMs < seconds * 1000) return undefined;
  return revealed ? settings.answerAction : "reveal";
}

export const siblingBuryOptions = [
  { field: "buryNewSiblings", label: "New siblings" },
  { field: "buryReviewSiblings", label: "Review siblings" },
  { field: "buryLearningSiblings", label: "Learning and relearning siblings" },
] as const;

export type ReviewerGesturePhase = { readonly cardId: string; readonly revealed: boolean };

/** A gesture belongs to the card side on which it started, never its replacement. */
export function reviewerGestureAction(
  gesture: {
    readonly startedOn: ReviewerGesturePhase;
    readonly current: ReviewerGesturePhase;
    readonly dx: number;
    readonly dy: number;
  },
  settings: ReviewerSettings,
): ReviewerAction | undefined {
  if (
    gesture.startedOn.cardId !== gesture.current.cardId ||
    gesture.startedOn.revealed !== gesture.current.revealed
  )
    return undefined;
  return reviewerSwipeAction(gesture.dx, gesture.dy, gesture.current.revealed, settings);
}
