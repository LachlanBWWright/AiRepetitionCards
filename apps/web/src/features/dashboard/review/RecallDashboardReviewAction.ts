import { Effect, Either } from "effect";
import type { ReviewEvent } from "@recall/domain";
import { rebuildScheduleEffect, type ReviewRating } from "@recall/scheduler";
import { localStudyDay, recordReview, saveWorkspace } from "@recall/application";
import type { Workspace } from "@/features/workspace/types";
import { browserReviewWorkspaceStore } from "@/features/workspace/browser-workspace-store";
import { localSnapshotStale } from "@/features/workspace/local-snapshot-status";
import {
  localWritesBlocked,
  setReviewWritePending,
} from "@/features/workspace/local-write-coordinator";
import type { PendingReview } from "@/features/dashboard/layout/RecallDashboardSupport";

type ReviewContext = {
  readonly rating: ReviewRating;
  readonly elapsedMs?: number;
  readonly reviewingRef: React.RefObject<boolean>;
  readonly pendingReviewRef: React.RefObject<PendingReview | null>;
  readonly area: Workspace["areas"][number] | undefined;
  readonly card: Workspace["areas"][number]["cards"][number] | undefined;
  readonly showAnswer: boolean;
  readonly erased: boolean;
  readonly stale: boolean;
  readonly demo: { readonly reviewSaveState?: "saving" | "failure" } | undefined;
  readonly ready: boolean;
  readonly cacheMayWrite: boolean;
  readonly workspaceRef: React.RefObject<Workspace>;
  readonly enqueueWorkspaceSave: <A>(operation: () => Promise<A>) => Promise<A>;
  readonly setReviewSaving: (value: boolean) => void;
  readonly setReviewSaveFailed: (value: boolean) => void;
  readonly setImportNotice: (value: string) => void;
  readonly setWorkspaceState: (value: Workspace) => void;
  readonly setSessionEvents: React.Dispatch<React.SetStateAction<readonly ReviewEvent[]>>;
  readonly setShowAnswer: (value: boolean) => void;
  readonly setNow: (value: Date) => void;
};

function areaWithUpdatedSchedule(
  area: Workspace["areas"][number],
  cardId: string,
  schedule: Workspace["areas"][number]["cards"][number]["schedule"],
): Workspace["areas"][number] {
  return {
    ...area,
    cards: area.cards.map((entry) => (entry.id === cardId ? { ...entry, schedule } : entry)),
  };
}

export async function reviewWorkspaceCard({
  rating,
  elapsedMs,
  reviewingRef,
  pendingReviewRef,
  area,
  card,
  showAnswer,
  erased,
  stale,
  demo,
  ready,
  cacheMayWrite,
  workspaceRef,
  enqueueWorkspaceSave,
  setReviewSaving,
  setReviewSaveFailed,
  setImportNotice,
  setWorkspaceState,
  setSessionEvents,
  setShowAnswer,
  setNow,
}: ReviewContext): Promise<void> {
  if (reviewingRef.current || (!pendingReviewRef.current && (!area || !card || !showAnswer)))
    return;
  if (
    erased ||
    stale ||
    localWritesBlocked() ||
    localSnapshotStale() ||
    (!demo && (!ready || !cacheMayWrite))
  ) {
    setImportNotice(
      "Local storage must be writable before a review can be saved. Export this tab before reloading if it has unsaved changes.",
    );
    return;
  }
  if (!pendingReviewRef.current && area && card) {
    const latest = workspaceRef.current.areas
      .find((item) => item.id === area.id)
      ?.cards.find((item) => item.id === card.id);
    if (!latest || JSON.stringify(latest.schedule) !== JSON.stringify(card.schedule)) return;
  }
  reviewingRef.current = true;
  setReviewSaving(true);
  setReviewSaveFailed(false);
  const outcome = await enqueueWorkspaceSave(async () => {
    if (!pendingReviewRef.current) {
      if (!area || !card) return false;
      const identity = Effect.runSync(
        Effect.either(
          Effect.try({
            try: () => crypto.randomUUID(),
            catch: () => ({ _tag: "ReviewIdentityUnavailable" }) as const,
          }),
        ),
      );
      if (Either.isLeft(identity)) return false;
      pendingReviewRef.current = {
        areaId: area.id,
        cardId: card.id,
        rating,
        eventId: identity.right,
        ratedAt: new Date().toISOString(),
        ...(elapsedMs !== undefined ? { elapsedMs } : {}),
        baseSchedule: JSON.stringify(card.schedule),
      };
    }
    if (!demo) setReviewWritePending(true);
    for (;;) {
      if (localWritesBlocked() || localSnapshotStale()) return false;
      const current = workspaceRef.current;
      const attempt: PendingReview = pendingReviewRef.current;
      const currentCard = current.areas
        .find((item) => item.id === attempt.areaId)
        ?.cards.find((item) => item.id === attempt.cardId);
      if (
        !currentCard ||
        (!attempt.event && JSON.stringify(currentCard.schedule) !== attempt.baseSchedule)
      ) {
        if (!attempt.event) {
          pendingReviewRef.current = null;
          if (!demo) setReviewWritePending(false);
          return "superseded" as const;
        }
        return false;
      }
      const targetEvents = (current.reviewEvents ?? []).filter(
        (event) => event.areaId === attempt.areaId && event.cardId === attempt.cardId,
      );
      let candidate: Workspace;
      if (!attempt.event || !attempt.schedule) {
        const transition = Effect.runSync(
          Effect.either(
            recordReview({
              workspace: current,
              ...attempt,
              studyDay: localStudyDay(Date.parse(attempt.ratedAt)),
            }),
          ),
        );
        if (Either.isLeft(transition)) return false;
        const schedule = transition.right.workspace.areas
          .find((item) => item.id === attempt.areaId)
          ?.cards.find((item) => item.id === attempt.cardId)?.schedule;
        if (!schedule) return false;
        pendingReviewRef.current = {
          ...attempt,
          event: transition.right.event,
          schedule,
          baseSchedule: JSON.stringify(currentCard.schedule),
          baseEvents: JSON.stringify(targetEvents),
        };
        candidate = transition.right.workspace;
      } else if ((current.reviewEvents ?? []).some((event) => event.id === attempt.event?.id)) {
        candidate = current;
      } else {
        const schedule =
          JSON.stringify(currentCard.schedule) === attempt.baseSchedule &&
          JSON.stringify(targetEvents) === attempt.baseEvents
            ? Either.right(attempt.schedule)
            : await Effect.runPromise(
                Effect.either(rebuildScheduleEffect([...targetEvents, attempt.event])),
              );
        if (Either.isLeft(schedule)) return false;
        candidate = {
          ...current,
          reviewEvents: [...(current.reviewEvents ?? []), attempt.event],
          pendingReviewEventIds: [
            ...new Set([...(current.pendingReviewEventIds ?? []), attempt.event.id]),
          ],
          reviews: Math.max(current.reviews, (current.reviewEvents ?? []).length) + 1,
          areas: current.areas.map((item) =>
            item.id === attempt.areaId
              ? areaWithUpdatedSchedule(item, attempt.cardId, schedule.right)
              : item,
          ),
        };
      }
      if (demo?.reviewSaveState === "failure") return false;
      const saved = demo
        ? Either.right(undefined)
        : await Effect.runPromise(
            Effect.either(saveWorkspace(browserReviewWorkspaceStore, candidate)),
          );
      if (Either.isLeft(saved) || localWritesBlocked() || localSnapshotStale()) return false;
      if (workspaceRef.current !== current) continue;
      workspaceRef.current = candidate;
      setWorkspaceState(candidate);
      const savedEvent = candidate.reviewEvents?.find((event) => event.id === attempt.eventId);
      if (savedEvent) setSessionEvents((events) => [...events, savedEvent]);
      pendingReviewRef.current = null;
      if (!demo) setReviewWritePending(false);
      setShowAnswer(false);
      setNow(new Date());
      return true;
    }
  });
  reviewingRef.current = false;
  setReviewSaving(false);
  if (outcome === "superseded") {
    setShowAnswer(false);
    setImportNotice(
      "The study queue changed before this review started saving. Reveal the current question's answer before rating it.",
    );
    return;
  }
  if (!outcome) setReviewSaveFailed(true);
}
