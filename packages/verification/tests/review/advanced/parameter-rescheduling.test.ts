import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import {
  recordReview,
  rebuildWorkspaceSchedules,
  updateSchedulerSettings,
} from "@recall/application";
import { newSchedule, rescheduleDueDate } from "@recall/scheduler";
import { workspace, card, areaId, now } from "./fixtures";

await test("due-date recalculation matches the FSRS 90% stability reference and respects interval bounds", () => {
  const schedule = {
    ...newSchedule(new Date(now)),
    state: 2 as const,
    stability: 20,
    last_review: new Date(now).toISOString(),
  };
  const due = Effect.runSync(rescheduleDueDate(schedule, { requestRetention: 0.9 }));
  assert.equal(Date.parse(due) - now, 20 * 86_400_000);
  const bounded = Effect.runSync(
    rescheduleDueDate(schedule, { requestRetention: 0.9, maximumInterval: 7 }),
  );
  assert.equal(Date.parse(bounded) - now, 7 * 86_400_000);
  assert.equal(
    Effect.runSync(rescheduleDueDate(newSchedule(new Date(now)), { requestRetention: 0.97 })),
    newSchedule(new Date(now)).due,
  );
});

await test("parameter changes require opt-in and append replayable due adjustments without changing answers", () => {
  const original = Effect.runSync(
    recordReview({
      workspace: workspace([card("a")]),
      areaId,
      cardId: "a",
      eventId: "first",
      rating: "easy",
      ratedAt: new Date(now).toISOString(),
    }),
  ).workspace;
  const settings = { requestRetention: 0.97, rescheduleOnParameterChange: true };
  const validationOnly = Effect.runSync(updateSchedulerSettings(original, settings));
  assert.deepEqual(validationOnly.areas, original.areas);
  const noOptIn = Effect.runSync(
    updateSchedulerSettings(original, { requestRetention: 0.97 }, new Date(now + 1000)),
  );
  assert.deepEqual(noOptIn.areas, original.areas);
  const updated = Effect.runSync(updateSchedulerSettings(original, settings, new Date(now + 1000)));
  assert.notEqual(
    updated.areas[0]?.cards[0]?.schedule.due,
    original.areas[0]?.cards[0]?.schedule.due,
  );
  assert.deepEqual(updated.reviewEvents, original.reviewEvents);
  assert.equal(updated.scheduleAdjustments?.length, 1);
  assert.deepEqual(Effect.runSync(rebuildWorkspaceSchedules(updated)), updated);
  assert.deepEqual(
    Effect.runSync(updateSchedulerSettings(updated, settings, new Date(now + 2000))),
    updated,
  );
});
