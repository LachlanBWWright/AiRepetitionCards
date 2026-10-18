import type { ReviewRating } from "@recall/scheduler";
import { reviewWorkspaceCard } from "@/features/dashboard/review/RecallDashboardReviewAction";
import type { RecallDashboardCore } from "../state/useRecallDashboardController";

export function createRecallDashboardReviewActions(
  model: Pick<
    RecallDashboardCore,
    | "reviewingRef"
    | "pendingReviewRef"
    | "area"
    | "card"
    | "showAnswer"
    | "erased"
    | "stale"
    | "demo"
    | "ready"
    | "cacheMayWrite"
    | "workspaceRef"
    | "enqueueWorkspaceSave"
    | "setReviewSaving"
    | "setReviewSaveFailed"
    | "setImportNotice"
    | "setWorkspaceState"
    | "setSessionEvents"
    | "setShowAnswer"
    | "setNow"
  >,
) {
  const {
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
  } = model;
  function review(rating: ReviewRating) {
    return reviewWorkspaceCard({
      rating,
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
    });
  }
  return { review } as const;
}
