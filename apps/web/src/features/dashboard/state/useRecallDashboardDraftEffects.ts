import { browserMediaStore } from "@/features/workspace/browser-media-store";
import type { RecallDashboardCore } from "./useRecallDashboardController";
import { useReviewCardMedia } from "../review/useReviewCardMedia";
export function useRecallDashboardDraftEffects(
  model: Pick<RecallDashboardCore, "demo" | "card" | "setMediaPreviews">,
) {
  useReviewCardMedia(
    browserMediaStore,
    model.card,
    model.setMediaPreviews,
    model.demo?.mockMediaPreviews,
  );
}
