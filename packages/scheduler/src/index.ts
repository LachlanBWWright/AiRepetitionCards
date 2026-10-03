import { createEmptyCard, fsrs, Rating, type Card, type CardInput, type Grade } from "ts-fsrs";
import type { CardSchedule } from "@recall/domain";
import type { ReviewEvent } from "@recall/domain";
import { orderReviewEvents } from "@recall/sync-core";

const scheduler = fsrs();

export type ReviewRating = "again" | "hard" | "good" | "easy";

const ratingValue: Record<ReviewRating, Grade> = {
  again: Rating.Again as Grade,
  hard: Rating.Hard as Grade,
  good: Rating.Good as Grade,
  easy: Rating.Easy as Grade,
};

export function storeSchedule(card: Card): CardSchedule {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    ...(card.last_review ? { last_review: card.last_review.toISOString() } : {}),
  };
}

export function schedulerInput(schedule: CardSchedule): CardInput {
  const { last_review: lastReview, ...state } = schedule;
  return {
    ...state,
    due: new Date(schedule.due),
    ...(typeof lastReview === "string" ? { last_review: new Date(lastReview) } : {}),
  };
}

export function newSchedule(now?: Date): CardSchedule {
  return storeSchedule(createEmptyCard(now));
}

export function scheduleReview(
  schedule: CardSchedule,
  rating: ReviewRating,
  now: Date = new Date(),
): CardSchedule {
  return storeSchedule(scheduler.next(schedulerInput(schedule), now, ratingValue[rating]).card);
}

export function rebuildSchedule(
  events: readonly ReviewEvent[],
  initialReviewAt?: Date,
): CardSchedule {
  const ordered = orderReviewEvents(events).events;
  const firstTimestamp = ordered[0]?.effectiveReviewedAt ?? ordered[0]?.ratedAt;
  let schedule = newSchedule(
    initialReviewAt ?? (firstTimestamp ? new Date(firstTimestamp) : undefined),
  );
  for (const event of ordered) {
    schedule = scheduleReview(
      schedule,
      event.rating,
      new Date(event.effectiveReviewedAt ?? event.ratedAt),
    );
  }
  return schedule;
}
