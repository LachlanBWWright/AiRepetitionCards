import { identifyObjectiveGaps } from "@recall/ai-core";
import { summarizeReviews } from "@recall/application";
import { orderReviewEvents } from "@recall/sync-core";
import type { LearningArea, Workspace } from "@/features/workspace/types";

export function summarizeDashboardReviews(
  workspace: Workspace,
  area: LearningArea | undefined,
  now: Date,
) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const events = workspace.reviewEvents ?? [];
  const practice = {
    today: summarizeReviews(events, dayStart, now),
    week: summarizeReviews(events, weekStart, now),
  };
  const objectiveGaps = area ? identifyObjectiveGaps(area, events, now) : [];
  const { concurrentEventIds } = orderReviewEvents(events);
  const reviewHistory = [...events]
    .sort((left, right) => right.ratedAt.localeCompare(left.ratedAt))
    .slice(0, 20)
    .map((event) => {
      const activeArea = workspace.areas.find((item) => item.id === event.areaId);
      const retainedArea = workspace.retainedReviewAreas?.find((item) => item.id === event.areaId);
      const retainedCard = retainedArea?.cards.find((item) => item.id === event.cardId);
      return {
        ...event,
        hasConcurrentBranch: concurrentEventIds.has(event.id),
        needsSyncRetry: (workspace.reviewConflictIds ?? []).includes(event.id),
        areaTitle: activeArea?.title ?? retainedArea?.title ?? "Removed area",
        question:
          activeArea?.cards.find((item) => item.id === event.cardId)?.front ??
          retainedCard?.front ??
          "Removed card",
        retainedForSync: Boolean(retainedCard),
      };
    });
  const retainedAreas = workspace.retainedReviewAreas ?? [];
  const retainedCards = retainedAreas.flatMap((item) => item.cards).length;
  const deletedRetainedAreas = retainedAreas.filter(
    (item) => !workspace.areas.some((active) => active.id === item.id),
  ).length;
  const pendingIds = new Set(workspace.pendingReviewEventIds ?? []);
  const retainedPendingReviews = events.filter(
    (event) =>
      pendingIds.has(event.id) &&
      retainedAreas.some(
        (item) => item.id === event.areaId && item.cards.some((entry) => entry.id === event.cardId),
      ),
  ).length;

  return {
    practice,
    objectiveGaps,
    reviewHistory,
    retainedCards,
    deletedRetainedAreas,
    retainedPendingReviews,
    studiedToday: practice.today.inWindow,
    totalReviews: Math.max(workspace.reviews, practice.today.total),
  };
}
