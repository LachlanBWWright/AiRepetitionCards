import type { LearningArea, ReviewEvent } from "@recall/domain";

/** Session evidence includes only reviews recorded by this client in the current session. */
export function summarizeStudySession(
  area: LearningArea,
  events: readonly ReviewEvent[],
  now: number,
) {
  const reviews = [
    ...new Map(
      events.filter((event) => event.areaId === area.id).map((event) => [event.id, event]),
    ).values(),
  ];
  const due = area.cards.filter((card) => Date.parse(card.schedule.due) <= now);
  const future = area.cards
    .map((card) => Date.parse(card.schedule.due))
    .filter((date) => Number.isFinite(date) && date > now);
  return {
    cardCount: area.cards.length,
    reviewed: reviews.length,
    recalled: reviews.filter((event) => event.rating !== "again").length,
    remaining: due.length,
    newCards: due.filter((card) => card.schedule.state === 0).length,
    learningCards: due.filter((card) => card.schedule.state === 1 || card.schedule.state === 3)
      .length,
    nextReviewAt: future.length > 0 ? Math.min(...future) : null,
  } as const;
}

export function formatReviewDelay(due: string, now: number): string {
  const minutes = Math.max(1, Math.ceil((Date.parse(due) - now) / 60_000));
  if (!Number.isFinite(minutes)) return "Unavailable";
  if (minutes < 60) return `${String(minutes)} min`;
  if (minutes < 1440) return `${String(Math.ceil(minutes / 60))} hr`;
  const days = Math.ceil(minutes / 1440);
  return `${String(days)} ${days === 1 ? "day" : "days"}`;
}
