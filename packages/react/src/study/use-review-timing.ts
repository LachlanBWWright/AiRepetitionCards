"use client";

import { useCallback, useEffect, useRef } from "react";
import { reviewElapsedMs } from "@recall/application";
export function useReviewTiming(
  cardId: string | undefined,
  hideAnswer: () => void,
  clock: () => number,
) {
  const previous = useRef(cardId);
  const startedAt = useRef(0);
  useEffect(() => {
    const changed = previous.current !== cardId;
    previous.current = cardId;
    startedAt.current = clock();
    if (changed) hideAnswer();
  }, [cardId, hideAnswer, clock]);
  return useCallback(() => reviewElapsedMs(startedAt.current, clock()), [clock]);
}
