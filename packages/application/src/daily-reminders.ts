import { Effect, Schema } from "effect";

export const DailyReminderSettingsSchema = Schema.Struct({
  enabled: Schema.Boolean,
  hour: Schema.Number.pipe(Schema.int(), Schema.between(0, 23)),
  minute: Schema.Number.pipe(Schema.int(), Schema.between(0, 59)),
});
export type DailyReminderSettings = typeof DailyReminderSettingsSchema.Type;
export const defaultDailyReminderSettings: DailyReminderSettings = {
  enabled: false,
  hour: 19,
  minute: 0,
};
export function validateDailyReminderSettings(input: unknown) {
  return Schema.decodeUnknown(DailyReminderSettingsSchema)(input).pipe(
    Effect.mapError(() => ({
      _tag: "DailyReminderSettingsFailure" as const,
      message: "Choose a valid local time for the daily reminder.",
    })),
  );
}
