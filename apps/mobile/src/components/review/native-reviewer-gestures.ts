import { AppState, PanResponder } from "react-native";
import { reviewerGestureAction, type ReviewerGesturePhase } from "@recall/application";
import type { ReviewerAction, ReviewerSettings } from "@recall/domain";

export type NativeReviewerGestureProps = {
  readonly cardId: string;
  readonly revealed: boolean;
  readonly disabled: boolean;
  readonly settings: ReviewerSettings;
  readonly onReveal: () => void;
  readonly onRate: (action: Exclude<ReviewerAction, "reveal">) => void;
};

/** Native responder lifetime outlasts renders; each release reads its latest host context. */
export function createNativeReviewerGestures(initial: NativeReviewerGestureProps) {
  let current = initial;
  let startedOn: ReviewerGesturePhase | null = null;
  const responder = PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      AppState.currentState === "active" &&
      !current.disabled &&
      current.settings.swipeEnabled &&
      gesture.numberActiveTouches === 1 &&
      Math.abs(gesture.dx) > 25 &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
    onStartShouldSetPanResponder: (_event, gesture) => {
      startedOn =
        gesture.numberActiveTouches === 1 && !current.disabled
          ? { cardId: current.cardId, revealed: current.revealed }
          : null;
      return false;
    },
    onPanResponderGrant: (_event, gesture) => {
      if (gesture.numberActiveTouches !== 1 || current.disabled) startedOn = null;
    },
    onPanResponderMove: (_event, gesture) => {
      if (gesture.numberActiveTouches > 1) startedOn = null;
    },
    onPanResponderTerminate: () => {
      startedOn = null;
    },
    onPanResponderRelease: (_event, gesture) => {
      const start = startedOn;
      startedOn = null;
      if (!start || current.disabled || AppState.currentState !== "active") return;
      const action = reviewerGestureAction(
        {
          startedOn: start,
          current: { cardId: current.cardId, revealed: current.revealed },
          dx: gesture.dx,
          dy: gesture.dy,
        },
        current.settings,
      );
      if (action === "reveal") current.onReveal();
      else if (action) current.onRate(action);
    },
  });
  return {
    panHandlers: responder.panHandlers,
    update: (next: NativeReviewerGestureProps) => {
      current = next;
      if (next.disabled) startedOn = null;
    },
    cancel: () => {
      startedOn = null;
    },
  };
}
