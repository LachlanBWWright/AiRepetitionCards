import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Card,
  type CardInput,
  type Grade,
} from "ts-fsrs";
import type { AssessmentSchedule } from "@recall/domain";
import type { ReviewEvent } from "@recall/domain";
import { orderReviewEvents } from "@recall/sync-core";
import { Effect } from "effect";

export type SchedulerParameters = {
  readonly requestRetention: number;
};

export const DEFAULT_SCHEDULER_PARAMETERS: SchedulerParameters = Object.freeze({
  requestRetention: 0.9,
});

export type UnknownSchedulerParameterSetError = {
  readonly _tag: "UnknownSchedulerParameterSetError";
  readonly parameterSetId: string;
};

export type SchedulerReplayUnavailable = {
  readonly _tag: "SchedulerReplayUnavailable";
  readonly reason: "invalid-timestamp" | "missing-initial-timestamp" | "vendor-failure";
  readonly eventId?: ReviewEvent["id"];
};

export type SchedulerReplayFailure = UnknownSchedulerParameterSetError | SchedulerReplayUnavailable;

// The version fixes the default weights and learning steps used in historical replay.
const parameterSetPrefix = "ts-fsrs-5.4.2-default-r";

export function schedulerParameterSetId(parameters: SchedulerParameters): string {
  return `${parameterSetPrefix}${String(Math.round(parameters.requestRetention * 10_000))}`;
}

export function schedulerParametersFromId(
  id: string | null | undefined,
): Effect.Effect<SchedulerParameters, UnknownSchedulerParameterSetError> {
  if (id === null || id === undefined) return Effect.succeed(DEFAULT_SCHEDULER_PARAMETERS);
  const suffix = id.startsWith(parameterSetPrefix) ? id.slice(parameterSetPrefix.length) : "";
  const retentionUnits = Number(suffix);
  if (/^\d{4}$/.test(suffix) && retentionUnits >= 7000 && retentionUnits <= 9700) {
    return Effect.succeed({ requestRetention: retentionUnits / 10_000 });
  }
  return Effect.fail({ _tag: "UnknownSchedulerParameterSetError", parameterSetId: id });
}

export type ReviewRating = "again" | "hard" | "good" | "easy";

const ratingValue: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const stateValue: Record<AssessmentSchedule["state"], State> = {
  0: State.New,
  1: State.Learning,
  2: State.Review,
  3: State.Relearning,
};

export function storeSchedule(card: Card): AssessmentSchedule {
  let state: AssessmentSchedule["state"];
  switch (card.state) {
    case State.New:
      state = 0;
      break;
    case State.Learning:
      state = 1;
      break;
    case State.Review:
      state = 2;
      break;
    case State.Relearning:
      state = 3;
      break;
  }
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state,
    ...(card.last_review ? { last_review: card.last_review.toISOString() } : {}),
  };
}

export function schedulerInput(schedule: AssessmentSchedule): CardInput {
  const lastReview = schedule.last_review;
  return {
    due: new Date(schedule.due),
    stability: schedule.stability,
    difficulty: schedule.difficulty,
    elapsed_days: schedule.elapsed_days,
    scheduled_days: schedule.scheduled_days,
    learning_steps: schedule.learning_steps,
    reps: schedule.reps,
    lapses: schedule.lapses,
    state: stateValue[schedule.state],
    ...(typeof lastReview === "string" ? { last_review: new Date(lastReview) } : {}),
  };
}

/** The caller supplies time so identical inputs produce identical schedules. */
export function newSchedule(now: Date): AssessmentSchedule {
  return storeSchedule(createEmptyCard(now));
}

export function scheduleReview(
  schedule: AssessmentSchedule,
  rating: ReviewRating,
  now: Date,
  parameters: SchedulerParameters = DEFAULT_SCHEDULER_PARAMETERS,
): AssessmentSchedule {
  const scheduler = fsrs({
    request_retention: Math.round(parameters.requestRetention * 10_000) / 10_000,
    enable_fuzz: false,
  });
  return storeSchedule(scheduler.next(schedulerInput(schedule), now, ratingValue[rating]).card);
}

/** Empty history needs an explicit initial timestamp; replay never reads the clock. */
export function rebuildScheduleEffect(
  events: readonly ReviewEvent[],
  initialReviewAt?: Date,
): Effect.Effect<AssessmentSchedule, SchedulerReplayFailure> {
  return Effect.gen(function* () {
    if (initialReviewAt && !Number.isFinite(initialReviewAt.getTime())) {
      return yield* Effect.fail({
        _tag: "SchedulerReplayUnavailable",
        reason: "invalid-timestamp",
      } as const);
    }
    for (const event of events) {
      if (
        !Number.isFinite(Date.parse(event.ratedAt)) ||
        (event.effectiveReviewedAt !== undefined &&
          !Number.isFinite(Date.parse(event.effectiveReviewedAt)))
      ) {
        return yield* Effect.fail({
          _tag: "SchedulerReplayUnavailable",
          reason: "invalid-timestamp",
          eventId: event.id,
        } as const);
      }
    }
    const ordered = orderReviewEvents(events).events;
    const firstTimestamp = ordered[0]?.effectiveReviewedAt ?? ordered[0]?.ratedAt;
    const initialTimestamp =
      initialReviewAt ?? (firstTimestamp ? new Date(firstTimestamp) : undefined);
    if (!initialTimestamp) {
      return yield* Effect.fail({
        _tag: "SchedulerReplayUnavailable",
        reason: "missing-initial-timestamp",
      } as const);
    }
    let schedule = yield* Effect.try({
      try: () => newSchedule(initialTimestamp),
      catch: (): SchedulerReplayUnavailable => ({
        _tag: "SchedulerReplayUnavailable",
        reason: "vendor-failure",
      }),
    });
    for (const event of ordered) {
      const parameters = yield* schedulerParametersFromId(event.schedulerParameterSetId);
      const previousSchedule = schedule;
      schedule = yield* Effect.try({
        try: () =>
          scheduleReview(
            previousSchedule,
            event.rating,
            new Date(event.effectiveReviewedAt ?? event.ratedAt),
            parameters,
          ),
        catch: (): SchedulerReplayUnavailable => ({
          _tag: "SchedulerReplayUnavailable",
          reason: "vendor-failure",
          eventId: event.id,
        }),
      });
    }
    return schedule;
  });
}

export const rebuildSchedule = rebuildScheduleEffect;
