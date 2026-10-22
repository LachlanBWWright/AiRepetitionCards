import { Effect, Schema } from "effect";
import { SchedulerPolicySchema } from "@recall/domain";

export const AdvancedParameterSchema = Schema.Struct({
  r: SchedulerPolicySchema.fields.requestRetention,
  w: SchedulerPolicySchema.fields.weights,
  l: SchedulerPolicySchema.fields.learningSteps,
  a: SchedulerPolicySchema.fields.relearningSteps,
  m: SchedulerPolicySchema.fields.maximumInterval,
  e: SchedulerPolicySchema.fields.easyDays,
  z: SchedulerPolicySchema.fields.timeZone,
  x: Schema.optional(
    Schema.String.pipe(
      Schema.filter((value) => Number.isFinite(Date.parse(value)) && /Z$/.test(value)),
    ),
  ),
});
export type AdvancedSchedulingParameters = {
  readonly learningSteps?: readonly number[] | undefined;
  readonly relearningSteps?: readonly number[] | undefined;
  readonly maximumInterval?: number | undefined;
  readonly easyDays?: readonly number[] | undefined;
  readonly timeZone?: string | undefined;
  readonly resetAt?: string | undefined;
};
export function validateSchedulingTimeZone(
  timeZone: string,
): Effect.Effect<void, { readonly _tag: "SchedulingTimeZoneInvalid" }> {
  return Effect.try({
    try: () => {
      new Intl.DateTimeFormat("en", { timeZone }).format(0);
    },
    catch: () => ({ _tag: "SchedulingTimeZoneInvalid" }) as const,
  });
}
