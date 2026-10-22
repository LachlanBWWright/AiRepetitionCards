import {
  createAreaId,
  createAssessmentId,
  createReviewEventId,
  type Assessment,
  type ReviewEvent,
  type Workspace,
} from "@recall/domain";
import { newSchedule, scheduleReview } from "@recall/scheduler";
export const now = Date.parse("2026-10-18T12:00:00.000Z");
export const day = {
  startsAt: Date.parse("2026-10-18T00:00:00.000Z"),
  endsAt: Date.parse("2026-10-19T00:00:00.000Z"),
};
export const areaId = createAreaId("advanced-area");
export function card(id: string, learning = false): Assessment {
  const at = new Date(now - 10 * 86_400_000);
  return {
    id: createAssessmentId(id),
    front: `${id} ATP synthase`,
    back: "Cellular respiration",
    objective: "Cells",
    tags: ["biology", "exam::cells"],
    schedule: learning ? scheduleReview(newSchedule(at), "easy", at) : newSchedule(new Date(now)),
  };
}
export function workspace(cards: readonly Assessment[] = [card("a"), card("b", true)]): Workspace {
  return {
    schemaVersion: 1,
    reviews: 0,
    reviewEvents: [],
    areas: [{ id: areaId, title: "Cell biology", color: "#123456", cards }],
    schedulerSettings: { requestRetention: 0.9, pauseNewWhenOverdue: false },
  };
}
export function review(
  index: number,
  at: number,
  id = "b",
  rating: ReviewEvent["rating"] = "good",
): ReviewEvent {
  return {
    id: createReviewEventId(`advanced-review-${String(index)}`),
    areaId,
    cardId: createAssessmentId(id),
    ratedAt: new Date(at).toISOString(),
    rating,
    schedulerFamily: "fsrs",
    schedulerVersion: "ts-fsrs@5.4.2",
    elapsedMs: 1000,
  };
}
