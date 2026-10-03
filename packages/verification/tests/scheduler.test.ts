import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { Effect, Either } from "effect";
import {
  createAreaId,
  createCardId,
  createDeviceId,
  createReviewEventId,
  type ReviewEvent,
} from "@recall/domain";
import {
  newSchedule,
  scheduleReview,
  rebuildScheduleEffect,
  schedulerParameterSetId,
  type ReviewRating,
} from "@recall/scheduler";

const initial = new Date("2026-01-01T12:00:00.000Z");
const areaId = createAreaId("00000000-0000-4000-8000-000000000001");
const cardId = createCardId("00000000-0000-4000-8000-000000000002");
const deviceId = createDeviceId("00000000-0000-4000-8000-000000000003");
const ratings: readonly ReviewRating[] = ["again", "hard", "good", "easy"];
function event(index: number, ratedAt: Date, rating: ReviewRating, retention = 0.9): ReviewEvent {
  return {
    id: createReviewEventId(`review-${String(index)}`),
    areaId,
    cardId,
    deviceId,
    deviceSequence: index,
    baseReviewEventId: index > 1 ? createReviewEventId(`review-${String(index - 1)}`) : null,
    ratedAt: ratedAt.toISOString(),
    reviewedAtDevice: ratedAt.toISOString(),
    effectiveReviewedAt: ratedAt.toISOString(),
    rating,
    schedulerFamily: "fsrs",
    schedulerVersion: "ts-fsrs@5.4.2",
    schedulerParameterSetId: schedulerParameterSetId({ requestRetention: retention }),
  };
}

await test("first review is deterministic, preserves input and records one repetition for every rating", () => {
  const original = newSchedule(initial);
  const snapshot = structuredClone(original);
  for (const rating of ratings) {
    const result = scheduleReview(original, rating, initial);
    assert.deepEqual(result, scheduleReview(original, rating, initial));
    assert.equal(result.reps, 1);
    assert.ok(Date.parse(result.due) >= initial.getTime());
    assert.ok(Number.isFinite(result.stability) && result.stability > 0);
    assert.equal(result.last_review, initial.toISOString());
  }
  assert.deepEqual(original, snapshot);
});

await test("repeated failures and same-day reviews keep every repetition and rebuild identically", () => {
  const history = [
    event(1, initial, "again"),
    event(2, new Date(initial.getTime() + 60_000), "again"),
    event(3, new Date(initial.getTime() + 120_000), "good"),
  ];
  let schedule = newSchedule(initial);
  for (const review of history)
    schedule = scheduleReview(schedule, review.rating, new Date(review.ratedAt));
  assert.equal(schedule.reps, 3);
  const replay = Effect.runSync(rebuildScheduleEffect([...history].reverse()));
  assert.deepEqual(replay, schedule);
  assert.equal(history.length, 3);
});

await test("long gaps and changed retention replay each event's original parameter set", () => {
  const history = [
    event(1, initial, "easy", 0.7),
    event(2, new Date("2027-01-01T12:00:00.000Z"), "again", 0.97),
    event(3, new Date("2027-01-01T12:02:00.000Z"), "good", 0.8),
  ];
  let schedule = newSchedule(initial);
  for (const [index, retention] of [0.7, 0.97, 0.8].entries()) {
    const review = history[index];
    assert.ok(review);
    schedule = scheduleReview(schedule, review.rating, new Date(review.ratedAt), {
      requestRetention: retention,
    });
  }
  assert.equal(schedule.reps, 3);
  assert.ok(schedule.lapses >= 1);
  assert.deepEqual(Effect.runSync(rebuildScheduleEffect(history)), schedule);
});

await test("unknown historical parameters and invalid timestamps return typed replay failures", () => {
  const unsupported = Effect.runSync(
    Effect.either(
      rebuildScheduleEffect([
        { ...event(1, initial, "good"), schedulerParameterSetId: "future-parameters-v2" },
      ]),
    ),
  );
  assert.ok(Either.isLeft(unsupported));
  assert.equal(unsupported.left._tag, "UnknownSchedulerParameterSetError");
  const invalid = Effect.runSync(
    Effect.either(
      rebuildScheduleEffect([{ ...event(1, initial, "good"), ratedAt: "invalid-time" }]),
    ),
  );
  assert.ok(Either.isLeft(invalid));
  assert.equal(invalid.left._tag, "SchedulerReplayUnavailable");
  const empty = Effect.runSync(Effect.either(rebuildScheduleEffect([])));
  assert.ok(Either.isLeft(empty));
  assert.equal(empty.left._tag, "SchedulerReplayUnavailable");
});

await test("property: caller-injected time and rating produce finite deterministic schedules without input mutation", () => {
  fc.assert(
    fc.property(
      fc.constantFrom<ReviewRating>("again", "hard", "good", "easy"),
      fc.integer({ min: 0, max: 525_600 }),
      fc.double({ min: 0.7, max: 0.97, noNaN: true, noDefaultInfinity: true }),
      (rating, minutes, requestRetention) => {
        const original = newSchedule(initial);
        const copy = structuredClone(original);
        const now = new Date(initial.getTime() + minutes * 60_000);
        const result = scheduleReview(original, rating, now, { requestRetention });
        assert.deepEqual(result, scheduleReview(original, rating, now, { requestRetention }));
        assert.deepEqual(original, copy);
        assert.equal(result.reps, 1);
        assert.ok(Number.isFinite(Date.parse(result.due)));
        assert.ok(Date.parse(result.due) >= now.getTime());
        assert.ok(Number.isFinite(result.stability) && Number.isFinite(result.difficulty));
      },
    ),
    { seed: 6117, numRuns: 100 },
  );
});
