import type { AssessmentSchedule } from "@recall/domain";
import type { AdvancedSchedulingParameters } from "./advanced-parameters";

/** Small deterministic shifts; short learning steps and maximum intervals remain respected. */
export function applyEasyDays(
  schedule: AssessmentSchedule,
  reviewedAt: Date,
  parameters: AdvancedSchedulingParameters,
): AssessmentSchedule {
  if (schedule.state !== 2 || !parameters.easyDays?.length || parameters.easyDays.length === 7)
    return schedule;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: parameters.timeZone ?? "UTC",
    weekday: "short",
  });
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const due = Date.parse(schedule.due);
  for (const offset of [0, 1, -1, 2, -2]) {
    const candidate = due + offset * 86_400_000;
    const interval = schedule.scheduled_days + offset;
    if (
      interval < 1 ||
      interval > (parameters.maximumInterval ?? 36500) ||
      candidate <= reviewedAt.getTime()
    )
      continue;
    if (!parameters.easyDays.includes(weekdays.indexOf(formatter.format(candidate))))
      return offset === 0
        ? schedule
        : { ...schedule, due: new Date(candidate).toISOString(), scheduled_days: interval };
  }
  return schedule;
}
