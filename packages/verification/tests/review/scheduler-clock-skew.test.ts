import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { Effect } from "effect";
import {
  createAreaId,
  createAssessmentId,
  createDeviceId,
  createReviewEventId,
  type ReviewEvent,
  type Workspace,
} from "@recall/domain";
import {
  newSchedule,
  previewReviewSchedules,
  rebuildScheduleEffect,
  scheduleReview,
} from "@recall/scheduler";
import { recordReview, rebuildWorkspaceSchedules } from "@recall/application";

const initial = new Date("2026-10-03T12:00:00.000Z");
const areaId = createAreaId("clock-skew-area");
const cardId = createAssessmentId("clock-skew-card");

function review(index: number, at: Date): ReviewEvent {
  return {
    id: createReviewEventId(`clock-skew-${String(index)}`),
    areaId,
    cardId,
    deviceId: createDeviceId("clock-skew-device"),
    deviceSequence: index,
    baseReviewEventId: index > 1 ? createReviewEventId(`clock-skew-${String(index - 1)}`) : null,
    ratedAt: at.toISOString(),
    reviewedAtDevice: at.toISOString(),
    effectiveReviewedAt: at.toISOString(),
    rating: "good",
    schedulerFamily: "fsrs",
    schedulerVersion: "ts-fsrs@5.4.2",
  };
}

function workspace(): Workspace {
  return {
    schemaVersion: 1,
    reviews: 0,
    reviewEvents: [],
    areas: [
      {
        id: areaId,
        title: "Clock skew",
        color: "#123456",
        cards: [
          {
            id: cardId,
            front: "Q",
            back: "A",
            objective: "Recall",
            schedule: newSchedule(initial),
          },
        ],
      },
    ],
  };
}

await test("causal replay clamps backwards effective times without rewriting review evidence", () => {
  const history = [
    review(1, initial),
    { ...review(2, initial), effectiveReviewedAt: "2026-10-01T12:00:00.000Z" },
    review(3, new Date("2026-10-02T12:00:00.000Z")),
    review(4, new Date("2026-10-04T12:00:00.000Z")),
  ];
  const original = structuredClone(history);
  let expected = newSchedule(initial);
  for (const at of [initial, initial, initial, new Date("2026-10-04T12:00:00.000Z")]) {
    expected = scheduleReview(expected, "good", at);
  }
  assert.deepEqual(Effect.runSync(rebuildScheduleEffect([...history].reverse())), expected);
  assert.equal(expected.reps, 4);
  assert.equal(expected.last_review, "2026-10-04T12:00:00.000Z");
  assert.deepEqual(history, original);
});

await test("live clock rollback preserves raw evidence and agrees with previews and workspace replay", () => {
  const startingWorkspace = workspace();
  let current = startingWorkspace;
  const original = structuredClone(startingWorkspace);
  for (const [index, at] of [initial, new Date("2026-10-01T12:00:00.000Z")].entries()) {
    const card = current.areas[0]?.cards[0];
    assert.ok(card);
    const preview = Effect.runSync(previewReviewSchedules(card.schedule, at));
    const result = Effect.runSync(
      recordReview({
        workspace: current,
        areaId,
        cardId,
        rating: "good",
        eventId: `clock-skew-${String(index + 1)}`,
        ratedAt: at.toISOString(),
      }),
    );
    current = result.workspace;
    const updatedSchedule = current.areas[0]?.cards[0]?.schedule;
    assert.ok(updatedSchedule);
    assert.deepEqual(updatedSchedule, preview.good);
    assert.equal(result.event.reviewedAtDevice, at.toISOString());
    assert.equal(result.event.effectiveReviewedAt, at.toISOString());
    assert.equal(updatedSchedule.last_review, initial.toISOString());
  }
  assert.deepEqual(Effect.runSync(rebuildWorkspaceSchedules(current)), current);
  assert.deepEqual(startingWorkspace, original);
});

await test("rollback clamps all ratings in learning, review, and relearning states", () => {
  const learning = scheduleReview(newSchedule(initial), "again", initial);
  const reviewing = scheduleReview(newSchedule(initial), "easy", initial);
  const later = new Date("2026-10-10T12:00:00.000Z");
  const relearning = scheduleReview(reviewing, "again", later);
  assert.equal(learning.state, 1);
  assert.equal(reviewing.state, 2);
  assert.equal(relearning.state, 3);
  for (const schedule of [learning, reviewing, relearning]) {
    const original = structuredClone(schedule);
    assert.ok(schedule.last_review);
    const lastReview = new Date(schedule.last_review);
    const rolledBack = new Date(lastReview.getTime() - 2 * 86_400_000);
    for (const rating of ["again", "hard", "good", "easy"] as const) {
      const result = scheduleReview(schedule, rating, rolledBack);
      assert.deepEqual(result, scheduleReview(schedule, rating, lastReview));
      assert.equal(result.last_review, schedule.last_review);
      assert.equal(result.reps, schedule.reps + 1);
      assert.ok(Date.parse(result.due) >= lastReview.getTime());
    }
    assert.deepEqual(schedule, original);
  }
});

await test("property: shuffled causal histories replay with nondecreasing scheduling time under clock skew", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: -10_080, max: 10_080 }), { minLength: 1, maxLength: 30 }),
      (offsets) => {
        const history = offsets.map((offset, index) =>
          review(index + 1, new Date(initial.getTime() + offset * 60_000)),
        );
        const first = history[0];
        assert.ok(first);
        let latest = Date.parse(first.ratedAt);
        let expected = newSchedule(new Date(latest));
        for (const event of history) {
          latest = Math.max(latest, Date.parse(event.ratedAt));
          expected = scheduleReview(expected, event.rating, new Date(latest));
        }
        const actual = Effect.runSync(rebuildScheduleEffect([...history].reverse()));
        assert.deepEqual(actual, expected);
        assert.equal(actual.reps, history.length);
        assert.ok(actual.elapsed_days >= 0);
      },
    ),
    { seed: 6118, numRuns: 100 },
  );
});
