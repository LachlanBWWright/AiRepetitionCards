import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { reviewerKeyAction, reviewerGestureAction } from "@recall/application";
import { useReviewerControls } from "@recall/react";
import type { ReviewerAction, ReviewerSettings } from "@recall/domain";

const isHostActive = () =>
  typeof document !== "undefined" && document.visibilityState !== "hidden" && document.hasFocus();
const elapsedNow = () => performance.now();
const blockingOverlay = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const editable =
  "input, textarea, select, button, a, audio, video, summary, [contenteditable], [role=dialog], [role=button], [role=slider], [role=spinbutton], [role=combobox], [role=textbox]";

export function useReviewerInteraction({
  cardId,
  revealed,
  enabled,
  settings,
  onReveal,
  onRate,
}: {
  readonly cardId: string | undefined;
  readonly revealed: boolean;
  readonly enabled: boolean;
  readonly settings: ReviewerSettings;
  readonly onReveal: () => void;
  readonly onRate: (rating: Exclude<ReviewerAction, "reveal">) => void;
}) {
  const [hostActive, setHostActive] = useState(isHostActive);
  const [modal, setModal] = useState(
    () => typeof document !== "undefined" && Boolean(document.querySelector(blockingOverlay)),
  );
  const pointer = useRef<{
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly cardId: string;
    readonly revealed: boolean;
  } | null>(null);
  useEffect(() => {
    const update = () => {
      setHostActive(isHostActive());
      const blocked = Boolean(document.querySelector(blockingOverlay));
      setModal(blocked);
      if (!isHostActive() || blocked) pointer.current = null;
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role"],
    });
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, []);
  const active = enabled && hostActive && !modal;
  useEffect(() => {
    if (!active) pointer.current = null;
  }, [active]);
  const dispatch = useCallback(
    (action: ReviewerAction) => {
      if (!active || !isHostActive() || document.querySelector(blockingOverlay)) return;
      if (action === "reveal") {
        if (!revealed) onReveal();
      } else if (revealed) onRate(action);
    },
    [active, onRate, onReveal, revealed],
  );
  const timer = useReviewerControls({
    cardId,
    revealed,
    active,
    settings,
    now: elapsedNow,
    onAction: dispatch,
  });
  useEffect(() => {
    if (!active || !cardId) return;
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (event.target instanceof Element && event.target.closest(editable)) return;
      const action = reviewerKeyAction(event.key, revealed, settings);
      if (!action || !isHostActive() || document.querySelector(blockingOverlay)) return;
      event.preventDefault();
      dispatch(action);
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [active, cardId, dispatch, revealed, settings]);
  return {
    ...timer,
    gestureHandlers: {
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        pointer.current = null;
        if (
          !active ||
          !cardId ||
          !settings.swipeEnabled ||
          event.pointerType === "mouse" ||
          !event.isPrimary
        )
          return;
        if (event.target instanceof Element && event.target.closest(editable)) return;
        pointer.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          cardId,
          revealed,
        };
      },
      onPointerCancel: () => {
        pointer.current = null;
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        const start = pointer.current;
        pointer.current = null;
        if (!start || !cardId || start.id !== event.pointerId) return;
        const action = reviewerGestureAction(
          {
            startedOn: start,
            current: { cardId, revealed },
            dx: event.clientX - start.x,
            dy: event.clientY - start.y,
          },
          settings,
        );
        if (action) dispatch(action);
      },
    },
  };
}
