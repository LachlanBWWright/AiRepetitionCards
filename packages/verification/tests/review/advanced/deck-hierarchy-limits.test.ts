import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import {
  createAreaId,
  createAssessmentId,
  createReviewEventId,
  type Assessment,
  type Workspace,
} from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import {
  studyQueue,
  studySessionQueue,
  studySessionArea,
  studySubjectTree,
  todayStudyLimits,
  recordReview,
} from "@recall/application";
const now = Date.parse("2026-10-20T12:00:00Z");
const day = { startsAt: now - 12 * 3600000, endsAt: now + 12 * 3600000 };
const parent = createAreaId("parent");
const child = createAreaId("child");
function card(id: string, state: Assessment["schedule"]["state"] = 2): Assessment {
  return {
    id: createAssessmentId(id),
    front: id,
    back: "Answer",
    objective: "Recall",
    schedule: { ...newSchedule(new Date(now)), state },
  };
}
function workspace(): Workspace {
  return {
    schemaVersion: 1,
    reviews: 0,
    areas: [
      { id: parent, title: "Parent", color: "#123456", cards: [card("parent-review")] },
      {
        id: child,
        title: "Child",
        color: "#123456",
        cards: [card("child-review"), card("child-learning", 1)],
      },
    ],
    schedulerSettings: {
      requestRetention: 0.9,
      pauseNewWhenOverdue: false,
      areaParents: { [child]: parent },
    },
  };
}
await test("zero review caps defer reviews but keep learning urgent and report backlog", () => {
  const original = workspace();
  const input = {
    ...original,
    schedulerSettings: {
      ...original.schedulerSettings,
      requestRetention: 0.9,
      dailyReviewLimit: 0,
    },
  };
  const area = input.areas[1];
  assert.ok(area);
  const queue = studyQueue(input, area, now, day);
  assert.deepEqual(
    queue.cards.map((item) => item.id),
    ["child-learning"],
  );
  assert.equal(queue.deferredReviewCount, 1);
  assert.equal(queue.dueCount, 2);
  assert.equal(studySessionArea(input, `scope:${parent}`, now)?.id, child);
});
await test("parent sessions return original area and hierarchy preserves depth", () => {
  const input = workspace();
  assert.equal(studySessionArea(input, `scope:${parent}`, now), input.areas[1]);
  assert.deepEqual(
    studySubjectTree(input).map(({ area, depth }) => [area.id, depth]),
    [
      [parent, 0],
      [child, 1],
    ],
  );
});
await test("ancestor review caps count first existing-card reviews even without imported history", () => {
  const original = workspace();
  const input = {
    ...original,
    schedulerSettings: {
      ...original.schedulerSettings,
      requestRetention: 0.9,
      areaReviewLimits: { [parent]: 1 },
    },
  };
  const result = Effect.runSync(
    recordReview({
      workspace: input,
      areaId: parent,
      cardId: "parent-review",
      eventId: createReviewEventId("rated-parent"),
      rating: "good",
      ratedAt: new Date(now).toISOString(),
      studyDay: day,
    }),
  );
  const area = result.workspace.areas[1];
  assert.ok(area);
  const queue = studyQueue(result.workspace, area, now, day);
  assert.equal(queue.reviewedToday, 1);
  assert.equal(queue.deferredReviewCount, 1);
  assert.deepEqual(
    queue.cards.map((item) => item.id),
    ["child-learning"],
  );
});
await test("today overrides expire and do not mutate normal limits", () => {
  const original = workspace();
  const settings = todayStudyLimits(
    { ...original.schedulerSettings, requestRetention: 0.9, dailyReviewLimit: 0 },
    day,
    { dailyReviewLimit: 3 },
    parent,
  );
  const input = { ...original, schedulerSettings: settings };
  const area = input.areas[0];
  assert.ok(area);
  // Global zero still constrains a subject override.
  assert.equal(studyQueue(input, area, now, day).cards.length, 0);
  const global = {
    ...input,
    schedulerSettings: todayStudyLimits(settings, day, { dailyReviewLimit: 3 }),
  };
  assert.equal(studyQueue(global, area, now, day).cards.length, 1);
  const tomorrow = { startsAt: day.endsAt, endsAt: day.endsAt + 86400000 };
  assert.equal(studyQueue(global, area, tomorrow.startsAt, tomorrow).cards.length, 0);
  assert.equal(settings.dailyReviewLimit, 0);
});
await test("group sessions never select cards outside the chosen descendants", () => {
  const original = workspace();
  const outsider = {
    id: createAreaId("outside"),
    title: "Outside",
    color: "#123456",
    cards: [card("urgent-outside", 1)],
  };
  const input = {
    ...original,
    areas: [...original.areas.map((area) => ({ ...area, cards: [] })), outsider],
  };
  assert.equal(studySessionArea(input, `scope:${parent}`, now)?.id, parent);
  assert.equal(studySessionArea(input, outsider.id, now)?.id, outsider.id);
});

await test("completed parent sessions retain deferred descendant backlog counts", () => {
  const original = workspace();
  const input = {
    ...original,
    areas: original.areas.map((area) => ({
      ...area,
      cards: area.cards.filter((card) => card.schedule.state === 2),
    })),
    schedulerSettings: {
      ...original.schedulerSettings,
      requestRetention: 0.9,
      dailyReviewLimit: 0,
    },
  };
  const area = studySessionArea(input, `scope:${parent}`, now);
  assert.ok(area);
  const queue = studySessionQueue(input, `scope:${parent}`, area, now);
  assert.equal(queue.cards.length, 0);
  assert.equal(queue.deferredReviewCount, 2);
});
