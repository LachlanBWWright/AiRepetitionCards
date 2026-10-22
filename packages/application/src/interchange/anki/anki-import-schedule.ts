import type { Assessment, ReviewEvent } from "@recall/domain";
import type { AnkiCardRow } from "./anki-import-contracts";

/** Import evidence is a baseline; historical answers are retained without replaying them twice. */
export function preserveAnkiSchedule(
  card: Assessment,
  original: AnkiCardRow["scheduling"],
  reviews: readonly ReviewEvent[],
): Assessment | undefined {
  if (!original || !Number.isFinite(Date.parse(original.due))) return undefined;
  const last =
    original.lastReview ?? reviews.at(-1)?.effectiveReviewedAt ?? reviews.at(-1)?.ratedAt;
  const schedule = {
    ...card.schedule,
    due: original.state === 0 ? card.schedule.due : original.due,
    scheduled_days: original.interval,
    stability:
      original.state === 0
        ? card.schedule.stability
        : (original.stability ?? Math.max(0.1, original.interval)),
    difficulty: original.difficulty ?? card.schedule.difficulty,
    reps: original.reps,
    lapses: original.lapses,
    state: original.state,
    ...(last && original.state !== 0 ? { last_review: last } : {}),
  };
  return {
    ...card,
    schedule,
    importedSchedule: { schedule, reviewEventIds: reviews.map((event) => event.id) },
  };
}
