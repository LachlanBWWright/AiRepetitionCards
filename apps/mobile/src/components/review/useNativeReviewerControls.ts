import { useEffect, useLayoutEffect, useState } from "react";
import { AppState } from "react-native";
import { useReviewerControls } from "@recall/react";
import type { ReviewerAction } from "@recall/domain";
import {
  createNativeReviewerGestures,
  type NativeReviewerGestureProps,
} from "./native-reviewer-gestures";

const elapsedNow = () => performance.now();

export function useNativeReviewerControls(props: NativeReviewerGestureProps) {
  const { cardId, revealed, disabled, settings, onReveal, onRate } = props;
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [gestures] = useState(() => createNativeReviewerGestures(props));
  useLayoutEffect(() => {
    gestures.update(props);
  }, [gestures, props]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      gestures.cancel();
      setForeground(state === "active");
    });
    return () => {
      subscription.remove();
    };
  }, [gestures]);
  const active = foreground && !disabled;
  const onAction = (action: ReviewerAction) => {
    if (!active || AppState.currentState !== "active") return;
    if (action === "reveal") {
      if (!revealed) onReveal();
    } else if (revealed) onRate(action);
  };
  const controls = useReviewerControls({
    cardId,
    revealed,
    active,
    settings,
    now: elapsedNow,
    onAction,
  });
  return { ...controls, panHandlers: gestures.panHandlers };
}
