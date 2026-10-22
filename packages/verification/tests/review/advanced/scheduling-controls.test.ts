import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either, Schema } from "effect";
import { SyncReviewOperationSchema } from "@recall/contracts";
import {
  newSchedule,
  scheduleReview,
  previewReviewSchedules,
  schedulerParameterSetId,
  schedulerParametersFromId,
} from "@recall/scheduler";
import { studyQueue } from "@recall/application";
import { workspace, card, now, day } from "./fixtures";

await test("custom steps, empty FSRS steps and maximum intervals produce matching previews", () => {
  const at = new Date(now);
  const original = newSchedule(at);
  const parameters = {
    requestRetention: 0.9,
    learningSteps: [3, 15],
    relearningSteps: [5],
    maximumInterval: 2,
  };
  assert.equal(Date.parse(scheduleReview(original, "again", at, parameters).due) - now, 3 * 60_000);
  const preview = Effect.runSync(previewReviewSchedules(original, at, parameters));
  assert.deepEqual(preview.good, scheduleReview(original, "good", at, parameters));
  const automatic = scheduleReview(original, "easy", at, {
    ...parameters,
    learningSteps: [],
    relearningSteps: [],
  });
  assert.equal(automatic.state, 2);
  assert.ok(automatic.scheduled_days <= 2);
});

await test("advanced policy identifiers pass the wire contract and replay all scheduling inputs", () => {
  const parameters = {
    requestRetention: 0.95,
    learningSteps: [2, 10, 30],
    relearningSteps: [5, 20],
    maximumInterval: 365,
    easyDays: [0, 6],
    timeZone: "Australia/Sydney",
    resetAt: "2026-01-01T12:00:00.000Z",
  };
  const id = schedulerParameterSetId(parameters);
  assert.ok(id.length <= 2048);
  assert.deepEqual(Effect.runSync(schedulerParametersFromId(id)), {
    ...parameters,
    weights: undefined,
  });
  assert.ok(
    Either.isRight(
      Schema.decodeUnknownEither(SyncReviewOperationSchema)({
        id: "00000000-0000-4000-8000-000000000001",
        cardId: "00000000-0000-4000-8000-000000000002",
        deviceSequence: 1,
        baseReviewEventId: null,
        reviewedAtDevice: new Date(now).toISOString(),
        effectiveReviewedAt: new Date(now).toISOString(),
        rating: "good",
        elapsedMs: 1234,
        schedulerFamily: "fsrs",
        schedulerVersion: "ts-fsrs@5.4.2",
        schedulerParameterSetId: id,
        previousStateHash: null,
      }),
    ),
  );
  assert.ok(
    Either.isLeft(
      Effect.runSync(Effect.either(schedulerParametersFromId('t542v2-{"r":0.9,"l":[10,1]}'))),
    ),
  );
  assert.ok(
    Either.isLeft(
      Effect.runSync(
        Effect.either(schedulerParametersFromId('t542v2-{"r":0.9,"z":"invalid/zone"}')),
      ),
    ),
  );
});

await test("reduced-load days shift review dates deterministically without changing learning steps", () => {
  const at = new Date(now);
  const original = newSchedule(at);
  const plain = scheduleReview(original, "easy", at);
  const weekday = new Date(plain.due).getUTCDay();
  const parameters = { requestRetention: 0.9, easyDays: [weekday], timeZone: "UTC" };
  const shifted = scheduleReview(original, "easy", at, parameters);
  assert.notEqual(new Date(shifted.due).getUTCDay(), weekday);
  assert.ok(Math.abs(Date.parse(shifted.due) - Date.parse(plain.due)) <= 2 * 86_400_000);
  assert.deepEqual(shifted, scheduleReview(original, "easy", at, parameters));
  assert.equal(
    scheduleReview(original, "again", at, parameters).due,
    scheduleReview(original, "again", at).due,
  );
});

await test("new/review mixing and interval ordering are configurable without mutating input", () => {
  const initial = workspace([
    card("new"),
    { ...card("long", true), schedule: { ...card("long", true).schedule, scheduled_days: 20 } },
    { ...card("short", true), schedule: { ...card("short", true).schedule, scheduled_days: 3 } },
  ]);
  const area = initial.areas[0];
  assert.ok(area);
  const before = {
    ...initial,
    schedulerSettings: {
      requestRetention: 0.9,
      pauseNewWhenOverdue: false,
      newReviewOrder: "before" as const,
      reviewOrder: "interval-ascending" as const,
    },
  };
  assert.deepEqual(
    studyQueue(before, area, now, day).cards.map((item) => item.id),
    ["new", "short", "long"],
  );
  const after = {
    ...before,
    schedulerSettings: {
      ...before.schedulerSettings,
      newReviewOrder: "after" as const,
      reviewOrder: "interval-descending" as const,
    },
  };
  assert.deepEqual(
    studyQueue(after, area, now, day).cards.map((item) => item.id),
    ["long", "short", "new"],
  );
});

await test("mixing uses due dates consistently even with recall or interval ordering selected", () => {
  const cards = [card("late", true), card("new"), card("early", true)].map((item, index) => ({
    ...item,
    schedule: { ...item.schedule, due: new Date(now - index * 1000).toISOString() },
  }));
  const initial = workspace(cards);
  const area = initial.areas[0];
  assert.ok(area);
  for (const reviewOrder of [
    "retrievability",
    "interval-ascending",
    "interval-descending",
  ] as const) {
    const mixed = {
      ...initial,
      schedulerSettings: {
        requestRetention: 0.9,
        pauseNewWhenOverdue: false,
        newReviewOrder: "mix" as const,
        reviewOrder,
      },
    };
    assert.deepEqual(
      studyQueue(mixed, area, now, day).cards.map((item) => item.id),
      ["early", "new", "late"],
    );
  }
});
