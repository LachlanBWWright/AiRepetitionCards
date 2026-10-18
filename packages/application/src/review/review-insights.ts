import type { ReviewEvent } from "@recall/domain";

export type ReviewInsights = {
  readonly total: number;
  readonly inWindow: number;
  readonly ratings: Readonly<Record<ReviewEvent["rating"], number>>;
};

/** Calendar boundaries come from the platform; counting is deterministic and history-only. */
export function summarizeReviews(
  events: readonly ReviewEvent[],
  startInclusive: Date,
  endInclusive: Date,
): ReviewInsights {
  const unique = [...new Map(events.map((event) => [event.id, event])).values()];
  const start = startInclusive.getTime();
  const end = endInclusive.getTime();
  const validWindow = Number.isFinite(start) && Number.isFinite(end) && start <= end;
  return unique.reduce<ReviewInsights>(
    (summary, event) => {
      const ratedAt = Date.parse(event.ratedAt);
      if (!validWindow || ratedAt < start || ratedAt > end || !Number.isFinite(ratedAt))
        return summary;
      return {
        ...summary,
        inWindow: summary.inWindow + 1,
        ratings: { ...summary.ratings, [event.rating]: summary.ratings[event.rating] + 1 },
      };
    },
    { total: unique.length, inWindow: 0, ratings: { again: 0, hard: 0, good: 0, easy: 0 } },
  );
}
