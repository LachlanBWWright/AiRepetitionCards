import type { AssessmentSchedule } from "@recall/domain";
import { Effect } from "effect";
import { fsrs } from "ts-fsrs";
import { canonicalSchedulerWeights, type SchedulerParameters } from "./parameters";
import { applyEasyDays } from "./configuration/easy-days";

/** Recalculate only the due date, without inventing an answer or changing historical memory. */
export function rescheduleDueDate(
  schedule: AssessmentSchedule,
  parameters: SchedulerParameters,
): Effect.Effect<string, { readonly _tag: "RescheduleUnavailable" }> {
  return Effect.try({
    try: () => {
      if (schedule.state !== 2 || !schedule.last_review || schedule.stability <= 0)
        return schedule.due;
      const scheduler = fsrs({
        enable_fuzz: false,
        request_retention: Math.round(parameters.requestRetention * 10_000) / 10_000,
        ...(parameters.weights ? { w: [...canonicalSchedulerWeights(parameters.weights)] } : {}),
        ...(parameters.maximumInterval ? { maximum_interval: parameters.maximumInterval } : {}),
      });
      const interval = scheduler.next_interval(schedule.stability, schedule.elapsed_days);
      const reviewedAt = new Date(schedule.last_review);
      return applyEasyDays(
        {
          ...schedule,
          due: new Date(reviewedAt.getTime() + interval * 86_400_000).toISOString(),
          scheduled_days: interval,
        },
        reviewedAt,
        parameters,
      ).due;
    },
    catch: () => ({ _tag: "RescheduleUnavailable" }) as const,
  });
}
