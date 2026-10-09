import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { defaultDailyReminderSettings, validateDailyReminderSettings } from "@recall/application";

void test("daily reminder defaults require explicit opt in", () => {
  assert.deepEqual(defaultDailyReminderSettings, { enabled: false, hour: 19, minute: 0 });
});

void test("daily reminder accepts every local clock minute without changing input", () => {
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += 1) {
      const input = Object.freeze({ enabled: true, hour, minute });
      const result = Effect.runSync(Effect.either(validateDailyReminderSettings(input)));
      assert.ok(Either.isRight(result));
      assert.deepEqual(result.right, input);
    }
  }
});

void test("daily reminder rejects malformed unknown values with a typed failure", () => {
  const invalid: readonly unknown[] = [
    null,
    undefined,
    [],
    "19:00",
    19,
    {},
    { enabled: "true", hour: 19, minute: 0 },
    { enabled: 1, hour: 19, minute: 0 },
    { enabled: false, hour: -1, minute: 0 },
    { enabled: false, hour: 24, minute: 0 },
    { enabled: true, hour: 1.5, minute: 0 },
    { enabled: true, hour: NaN, minute: 0 },
    { enabled: true, hour: Infinity, minute: 0 },
    { enabled: true, hour: 19, minute: -1 },
    { enabled: true, hour: 19, minute: 60 },
    { enabled: true, hour: 19, minute: 0.5 },
    { enabled: true, hour: 19, minute: "0" },
    { hour: 19, minute: 0 },
  ];
  for (const input of invalid) {
    const result = Effect.runSync(Effect.either(validateDailyReminderSettings(input)));
    assert.ok(Either.isLeft(result));
    assert.equal(result.left._tag, "DailyReminderSettingsFailure");
  }
});

void test("daily reminder decodes only supported fields", () => {
  const result = Effect.runSync(
    Effect.either(
      validateDailyReminderSettings({
        enabled: false,
        hour: 0,
        minute: 59,
        permission: "granted",
        lastDeliveredDay: "today",
      }),
    ),
  );
  assert.ok(Either.isRight(result));
  assert.deepEqual(result.right, { enabled: false, hour: 0, minute: 59 });
});
