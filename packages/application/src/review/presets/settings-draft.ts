import type { SchedulerSettings } from "@recall/domain";

/** Preserve the saved precision unless the user actually changes its displayed value. */
export function schedulerSettingsDraft(
  settings: SchedulerSettings,
  fields: {
    readonly retentionPercent?: string;
    readonly dailyNewLimit?: string;
    readonly leechThreshold?: string;
  },
): SchedulerSettings {
  const number = (value: string) => (value.trim() ? Number(value) : NaN);
  const retention =
    fields.retentionPercent === undefined
      ? settings.requestRetention
      : number(fields.retentionPercent) === settings.requestRetention * 100 ||
          number(fields.retentionPercent) ===
            Number((settings.requestRetention * 100).toPrecision(12))
        ? settings.requestRetention
        : number(fields.retentionPercent) / 100;
  return {
    ...settings,
    requestRetention: retention,
    ...(fields.dailyNewLimit === undefined ? {} : { dailyNewLimit: number(fields.dailyNewLimit) }),
    ...(fields.leechThreshold === undefined
      ? {}
      : { leechThreshold: number(fields.leechThreshold) }),
  };
}
export const parseLearningSteps = (value: string): readonly number[] =>
  value.trim() ? value.trim().split(/\s+/).map(Number) : [];
