import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssessmentId, createAreaId } from "@recall/domain";
import { studyCalendar, studyStatistics } from "@recall/application";
import { workspace, card, review, now, areaId } from "./fixtures";

await test("retention uses only first daily answers and timing excludes unrecorded durations", () => {
  const first = review(1, now - 60_000, "a", "again");
  const retry = review(2, now - 30_000, "a", "good");
  const second = { ...review(3, now - 1000, "b", "hard"), elapsedMs: null };
  const initial = { ...workspace(), reviewEvents: [first, first, retry, second] };
  const original = structuredClone(initial);
  const stats = studyStatistics(initial, now, studyCalendar(now, 7, 30));
  assert.equal(stats.retentionAttempts, 2);
  assert.equal(stats.trueRetention, 0.5);
  assert.equal(stats.elapsedMs, 2000);
  assert.equal(stats.timedReviews, 2);
  assert.equal(
    stats.calendar.reduce((sum, day) => sum + day.reviews, 0),
    3,
  );
  assert.deepEqual(initial, original);
});

await test("forecasts separate overdue cards and exclude new and suspended cards", () => {
  const initial = workspace([
    card("new"),
    {
      ...card("tomorrow", true),
      schedule: {
        ...card("tomorrow", true).schedule,
        due: new Date(now + 86_400_000).toISOString(),
      },
    },
    {
      ...card("suspended", true),
      schedule: {
        ...card("suspended", true).schedule,
        due: new Date(now + 86_400_000).toISOString(),
      },
    },
    {
      ...card("overdue", true),
      schedule: {
        ...card("overdue", true).schedule,
        due: new Date(now - 86_400_000).toISOString(),
      },
    },
  ]);
  const stats = studyStatistics(
    {
      ...initial,
      schedulerSettings: {
        requestRetention: 0.9,
        suspendedCardIds: [createAssessmentId("suspended")],
      },
    },
    now,
    studyCalendar(now),
  );
  assert.equal(
    stats.forecast.reduce((sum, day) => sum + day.count, 0),
    1,
  );
  assert.equal(stats.overdue, 1);
  assert.equal(stats.suspendedCards, 1);
  assert.equal(stats.newCards, 1);
  assert.ok(Number.isFinite(stats.estimatedRemembered));
});

await test("statistics scope and empty collections produce finite, explicit results", () => {
  const initial = workspace([]);
  const stats = studyStatistics(initial, now, studyCalendar(now), areaId);
  assert.equal(stats.trueRetention, null);
  assert.equal(stats.averageRecall, null);
  assert.equal(stats.dailyLoad, 0);
  assert.equal(stats.totalCards, 0);
});

await test("subject statistics include descendants but exclude unrelated subjects", () => {
  const childId = createAreaId("child");
  const outsideId = createAreaId("outside");
  const initial = workspace([card("parent")]);
  const parent = initial.areas[0];
  assert.ok(parent);
  const grouped = {
    ...initial,
    areas: [
      parent,
      { ...parent, id: childId, cards: [card("child")] },
      { ...parent, id: outsideId, cards: [card("outside")] },
    ],
    schedulerSettings: { requestRetention: 0.9, areaParents: { [childId]: areaId } },
    reviewEvents: [
      { ...review(1, now - 1000), areaId: childId },
      { ...review(2, now - 1000), areaId: outsideId },
    ],
  };
  const stats = studyStatistics(grouped, now, studyCalendar(now), areaId);
  assert.equal(stats.totalCards, 2);
  assert.equal(stats.retentionAttempts, 1);
});
