import { Effect } from "effect";
import { createEmptyCard, fsrs, Rating, type Card, type Grade } from "ts-fsrs";
import type { ReviewEvent } from "@recall/domain";
const grades: Readonly<Record<ReviewEvent["rating"], Grade>> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};
type Loss = {
  readonly training: number;
  readonly validation: number;
  readonly count: number;
  readonly validationCount: number;
  readonly rmse: number;
  readonly calibration: readonly {
    readonly predicted: number;
    readonly observed: number;
    readonly count: number;
  }[];
};

/** Score next-answer recall, before incorporating the answer, using the latest 20% of timestamps as holdout. */
export function evaluate(
  events: readonly ReviewEvent[],
  weights: readonly number[],
  cutoff: number,
  reviewedAfter: number,
): Effect.Effect<Loss> {
  return Effect.gen(function* () {
    const scheduler = fsrs({ w: [...weights], enable_fuzz: false });
    const cards = new Map<string, Card>();
    let training = 0;
    let validation = 0;
    let count = 0;
    let validationCount = 0;
    let squaredError = 0;
    const buckets = Array.from({ length: 10 }, () => ({ predicted: 0, observed: 0, count: 0 }));
    let processed = 0;
    for (const event of events) {
      if (processed++ % 512 === 0) yield* Effect.yieldNow();
      const key = `${event.areaId}:${event.cardId}`;
      const previous = cards.get(key);
      const at = new Date(
        Math.max(
          Date.parse(event.effectiveReviewedAt ?? event.ratedAt),
          previous?.last_review?.getTime() ?? -Infinity,
        ),
      );
      const card: Card = previous ?? createEmptyCard(at);
      if (
        previous?.last_review &&
        at.getTime() >= reviewedAfter &&
        at.getTime() - previous.last_review.getTime() >= 86_400_000
      ) {
        const probability = Math.max(
          0.001,
          Math.min(0.999, scheduler.get_retrievability(card, at, false)),
        );
        const loss = -Math.log(event.rating === "again" ? 1 - probability : probability);
        count += 1;
        if (at.getTime() >= cutoff) {
          const outcome = event.rating === "again" ? 0 : 1;
          squaredError += (probability - outcome) ** 2;
          const bucket = buckets[Math.min(9, Math.floor(probability * 10))];
          if (bucket) {
            bucket.predicted += probability;
            bucket.observed += outcome;
            bucket.count += 1;
          }
          validation += loss;
          validationCount += 1;
        } else training += loss;
      }
      cards.set(key, scheduler.next(card, at, grades[event.rating]).card);
    }
    return {
      training: training / Math.max(1, count - validationCount),
      validation: validation / Math.max(1, validationCount),
      count,
      validationCount,
      rmse: Math.sqrt(squaredError / Math.max(1, validationCount)),
      calibration: buckets
        .filter((bucket) => bucket.count)
        .map((bucket) => ({
          predicted: bucket.predicted / bucket.count,
          observed: bucket.observed / bucket.count,
          count: bucket.count,
        })),
    };
  });
}
