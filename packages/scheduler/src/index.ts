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
import { applyEasyDays } from "./configuration/easy-days";

import {
  DEFAULT_SCHEDULER_PARAMETERS,
  schedulerParametersFromId,
  canonicalSchedulerWeights,
  type SchedulerParameters,
  type UnknownSchedulerParameterSetError,
} from "./parameters";
export * from "./parameters";
export {
  fitSchedulerParameters,
  type ParameterFitFailure,
  type ParameterFitProposal,
  type ParameterFitOptions,
} from "./fit-parameters";

export type SchedulerReplayUnavailable = {
  readonly _tag: "SchedulerReplayUnavailable";
  readonly reason: "invalid-timestamp" | "missing-initial-timestamp" | "vendor-failure";
  readonly eventId?: ReviewEvent["id"];
};

export type SchedulerReplayFailure = UnknownSchedulerParameterSetError | SchedulerReplayUnavailable;

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
    ...(parameters.weights ? { w: [...canonicalSchedulerWeights(parameters.weights)] } : {}),
    ...(parameters.learningSteps
      ? {
          learning_steps: parameters.learningSteps.map(
            (minutes) => `${String(minutes)}m` as `${number}m`,
          ),
        }
      : {}),
    ...(parameters.relearningSteps
      ? {
          relearning_steps: parameters.relearningSteps.map(
            (minutes) => `${String(minutes)}m` as `${number}m`,
          ),
        }
      : {}),
    ...(parameters.maximumInterval !== undefined
      ? { maximum_interval: parameters.maximumInterval }
      : {}),
  });
  const resetAt = parameters.resetAt ? Date.parse(parameters.resetAt) : -Infinity;
  const base =
    schedule.last_review && Date.parse(schedule.last_review) < resetAt
      ? newSchedule(new Date(resetAt))
      : schedule;
  // Causal order can disagree with device/server timestamps after clock correction.
  // Clamp only the derived scheduling time; callers retain the original event evidence.
  const reviewAt = new Date(
    Math.max(
      now.getTime(),
      resetAt,
      typeof base.last_review === "string" ? Date.parse(base.last_review) : -Infinity,
    ),
  );
  return applyEasyDays(
    storeSchedule(scheduler.next(schedulerInput(base), reviewAt, ratingValue[rating]).card),
    reviewAt,
    parameters,
  );
}

export function previewReviewSchedules(
  schedule: AssessmentSchedule,
  now: Date,
  parameters: SchedulerParameters = DEFAULT_SCHEDULER_PARAMETERS,
): Effect.Effect<
  Readonly<Record<ReviewRating, AssessmentSchedule>>,
  { readonly _tag: "SchedulerPreviewUnavailable" }
> {
  return Effect.try({
    try: () => ({
      again: scheduleReview(schedule, "again", now, parameters),
      hard: scheduleReview(schedule, "hard", now, parameters),
      good: scheduleReview(schedule, "good", now, parameters),
      easy: scheduleReview(schedule, "easy", now, parameters),
    }),
    catch: () => ({ _tag: "SchedulerPreviewUnavailable" }) as const,
  });
}

/** Empty history needs an explicit initial timestamp; replay never reads the clock. */
export function rebuildScheduleEffect(
  events: readonly ReviewEvent[],
  initialReviewAt?: Date,
  initialSchedule?: AssessmentSchedule,
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
    let schedule =
      initialSchedule ??
      (yield* Effect.try({
        try: () => newSchedule(initialTimestamp),
        catch: (): SchedulerReplayUnavailable => ({
          _tag: "SchedulerReplayUnavailable",
          reason: "vendor-failure",
        }),
      }));
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

/** Recall probability is derived from card state; callers supply the clock. */
export function recallProbability(
  schedule: AssessmentSchedule,
  now: Date,
  parameters: SchedulerParameters = DEFAULT_SCHEDULER_PARAMETERS,
): number | null {
  if (!schedule.last_review || schedule.stability <= 0) return null;
  return Effect.runSync(
    Effect.try({
      try: () =>
        fsrs({
          enable_fuzz: false,
          ...(parameters.weights ? { w: [...canonicalSchedulerWeights(parameters.weights)] } : {}),
        }).get_retrievability(schedulerInput(schedule), now, false),
      catch: () => ({ _tag: "RecallProbabilityUnavailable" }) as const,
    }).pipe(
      Effect.match({
        onFailure: () => null,
        onSuccess: (probability) => (Number.isFinite(probability) ? probability : null),
      }),
    ),
  );
}

export { rescheduleDueDate } from "./reschedule-due";
