import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import {
  createAreaId,
  createAssessmentId,
  createReviewEventId,
  parseWorkspaceJson,
  type Assessment,
  type ReviewEvent,
  type Workspace,
} from "@recall/domain";
import { newSchedule, scheduleReview } from "@recall/scheduler";
import {
  studyQueue,
  studyCardStatus,
  startCramSession,
  cramCard,
  rateCramCard,
  updateSchedulerSettings,
  recordReview,
} from "@recall/application";

const now = Date.parse("2026-10-18T12:00:00.000Z");
const day = {
  startsAt: Date.parse("2026-10-18T00:00:00.000Z"),
  endsAt: Date.parse("2026-10-19T00:00:00.000Z"),
};
const areaId = createAreaId("study-area");
function card(id: string, state: Assessment["schedule"]["state"] = 0, due = now): Assessment {
  return {
    id: createAssessmentId(id),
    front: id,
    back: "Answer",
    objective: "Recall",
    schedule: { ...newSchedule(new Date(now)), state, due: new Date(due).toISOString() },
  };
}
function workspace(cards: readonly Assessment[]): Workspace {
  return {
    schemaVersion: 1,
    reviews: 0,
    reviewEvents: [],
    areas: [{ id: areaId, title: "Study", color: "#123456", cards }],
    schedulerSettings: { requestRetention: 0.9, pauseNewWhenOverdue: false },
  };
}
function queue(input: Workspace, at = now, studyDay = day) {
  const area = input.areas[0];
  assert.ok(area);
  return studyQueue(input, area, at, studyDay);
}
function review(cardId: string, at = now, index = 1): ReviewEvent {
  return {
    id: createReviewEventId(`study-${String(index)}`),
    areaId,
    cardId: createAssessmentId(cardId),
    rating: "good",
    ratedAt: new Date(at).toISOString(),
    schedulerFamily: "fsrs",
    schedulerVersion: "ts-fsrs@5.4.2",
  };
}

await test("learning steps and old reviews precede new cards, independent of storage order", () => {
  const input = workspace([
    card("new"),
    card("review", 2, now - 120_000),
    card("learning", 1),
    card("relearning", 3, now - 60_000),
    card("future", 2, now + 60_000),
  ]);
  const original = structuredClone(input);
  assert.deepEqual(
    queue(input).cards.map((item) => item.id),
    ["relearning", "learning", "review", "new"],
  );
  assert.deepEqual(input, original);
});

await test("new-card budget counts first introductions across subjects and deduplicates history", () => {
  const input = workspace([card("a"), card("b"), card("c")]);
  const event = { ...review("other-card"), areaId: createAreaId("other-area") };
  const limited = {
    ...input,
    schedulerSettings: { requestRetention: 0.9, dailyNewLimit: 2 },
    reviewEvents: [
      event,
      event,
      { ...event, id: createReviewEventId("retry"), ratedAt: new Date(now + 1000).toISOString() },
    ],
  };
  assert.equal(queue(limited).introducedToday, 1);
  assert.equal(queue(limited).cards.length, 1);
  assert.equal(queue(limited).deferredNewCount, 2);
  const zero = { ...input, schedulerSettings: { requestRetention: 0.9, dailyNewLimit: 0 } };
  assert.equal(queue(zero).cards.length, 0);
  const nextDay = { startsAt: day.endsAt, endsAt: day.endsAt + 86_400_000 };
  assert.equal(queue(limited, nextDay.startsAt, nextDay).cards.length, 2);
});

await test("an old card reviewed today does not consume the new-card budget", () => {
  const input = {
    ...workspace([card("new")]),
    reviewEvents: [review("old", day.startsAt - 86_400_000), review("old", now, 2)],
    schedulerSettings: { requestRetention: 0.9, dailyNewLimit: 1 },
  };
  assert.equal(queue(input).introducedToday, 0);
  assert.equal(queue(input).cards.length, 1);
});

await test("backlog pauses introductions without hiding overdue work; suspension is reversible", () => {
  const input = workspace([card("new"), card("overdue", 2, day.startsAt - 60_000)]);
  const paused = { ...input, schedulerSettings: { requestRetention: 0.9 } };
  assert.deepEqual(
    queue(paused).cards.map((item) => item.id),
    ["overdue"],
  );
  assert.equal(queue(paused).pauseNew, true);
  const suspended = Effect.runSync(
    updateSchedulerSettings(paused, {
      requestRetention: 0.9,
      suspendedCardIds: [createAssessmentId("overdue")],
    }),
  );
  assert.deepEqual(
    queue(suspended).cards.map((item) => item.id),
    ["new"],
  );
  assert.equal(
    studyCardStatus(suspended, suspended.areas[0]?.cards[1] ?? card("missing")).suspended,
    true,
  );
  assert.deepEqual(
    queue(Effect.runSync(updateSchedulerSettings(suspended, { requestRetention: 0.9 }))).cards.map(
      (item) => item.id,
    ),
    ["overdue"],
  );
  assert.deepEqual(suspended.reviewEvents, paused.reviewEvents);
});

await test("reviewed siblings bury related cards for the day while allowing learning repetitions", () => {
  const sibling = { ...card("sibling"), siblingId: "note-1" };
  const learned = { ...card("learned", 1), siblingId: "note-1" };
  const input = {
    ...workspace([sibling, learned, card("unrelated")]),
    reviewEvents: [review("learned")],
  };
  assert.deepEqual(
    queue(input).cards.map((item) => item.id),
    ["learned", "unrelated"],
  );
  assert.equal(queue(input).buriedCount, 1);
  assert.equal(
    queue({ ...input, schedulerSettings: { requestRetention: 0.9, burySiblings: false } })
      .buriedCount,
    0,
  );
  const tomorrow = { startsAt: day.endsAt, endsAt: day.endsAt + 86_400_000 };
  assert.equal(queue(input, tomorrow.startsAt, tomorrow).buriedCount, 0);
});

await test("legacy Anki note identities and authored cloze text identify sibling groups", () => {
  const input = {
    ...workspace([
      { ...card("first"), sourceId: "anki:note-guid:0" },
      { ...card("reverse"), sourceId: "anki:note-guid:1" },
    ]),
    reviewEvents: [review("first")],
  };
  assert.equal(queue(input).buriedCount, 1);
  const text = "{{c1::ATP}} is {{c2::energy}}";
  const clozeInput = {
    ...workspace([
      { ...card("one"), cloze: { text, deletionIndex: 1 } },
      { ...card("two"), cloze: { text, deletionIndex: 2 } },
    ]),
    reviewEvents: [review("one")],
  };
  assert.equal(queue(clozeInput).buriedCount, 1);
});

await test("leech detection counts review lapses and never silently suspends a card", () => {
  const input = workspace([]);
  const leech = {
    ...card("leech", 2),
    schedule: { ...card("leech", 2).schedule, lapses: 8, reps: 50 },
  };
  assert.deepEqual(studyCardStatus(input, leech), { leech: true, suspended: false, lapses: 8 });
  assert.equal(
    studyCardStatus(input, { ...leech, schedule: { ...leech.schedule, lapses: 0 } }).leech,
    false,
  );
});

await test("extra practice requeues forgotten answers without modifying schedules or review evidence", () => {
  const input = workspace([card("one"), card("two"), card("suspended")]);
  const original = structuredClone(input);
  const area = input.areas[0];
  assert.ok(area);
  const start = startCramSession(area, ["suspended"]);
  assert.equal(cramCard(start, area)?.id, "one");
  const failed = rateCramCard(start, "one", "again");
  assert.deepEqual(failed.remainingIds, ["two", "one"]);
  const next = rateCramCard(failed, "two", "good");
  const finished = rateCramCard(next, "one", "easy");
  assert.equal(cramCard(finished, area), undefined);
  assert.equal(finished.answered, 3);
  assert.equal(finished.recalled, 2);
  assert.deepEqual(start.remainingIds, ["one", "two"]);
  assert.deepEqual(input, original);
});

await test("private study controls and sibling identities survive backups and invalid limits fail validation", () => {
  const input = workspace([{ ...card("one"), siblingId: "note" }]);
  const saved = Effect.runSync(
    updateSchedulerSettings(input, {
      requestRetention: 0.92,
      dailyNewLimit: 5,
      suspendedCardIds: [createAssessmentId("one")],
      burySiblings: false,
      reviewOrder: "retrievability",
      leechThreshold: 5,
    }),
  );
  assert.deepEqual(Effect.runSync(parseWorkspaceJson(JSON.stringify(saved))), saved);
  for (const settings of [
    { requestRetention: 0.9, dailyNewLimit: -1 },
    { requestRetention: 0.9, dailyNewLimit: 2.5 },
    { requestRetention: 0.9, leechThreshold: 0 },
  ])
    assert.ok(
      Either.isLeft(Effect.runSync(Effect.either(updateSchedulerSettings(saved, settings)))),
    );
});

await test("recall-based ordering prioritizes the less stable review when due dates match", () => {
  const at = new Date(day.startsAt - 10 * 86_400_000);
  const schedule = scheduleReview(newSchedule(at), "easy", at);
  const input = workspace([
    { ...card("strong", 2), schedule: { ...schedule, due: at.toISOString(), stability: 30 } },
    { ...card("weak", 2), schedule: { ...schedule, due: at.toISOString(), stability: 2 } },
  ]);
  const result = queue({
    ...input,
    schedulerSettings: { requestRetention: 0.9, reviewOrder: "retrievability" },
  });
  assert.deepEqual(
    result.cards.map((item) => item.id),
    ["weak", "strong"],
  );
});

await test("recording rechecks suspension and the current daily budget before appending evidence", () => {
  const input = workspace([card("new")]);
  const attempt = (current: Workspace) =>
    Effect.runSync(
      Effect.either(
        recordReview({
          workspace: current,
          areaId,
          cardId: createAssessmentId("new"),
          rating: "good",
          eventId: "policy-review",
          ratedAt: new Date(now).toISOString(),
          studyDay: day,
        }),
      ),
    );
  for (const settings of [
    { requestRetention: 0.9, dailyNewLimit: 0 },
    { requestRetention: 0.9, suspendedCardIds: [createAssessmentId("new")] },
  ]) {
    const blocked = { ...input, schedulerSettings: settings };
    const result = attempt(blocked);
    assert.ok(Either.isLeft(result));
    assert.equal(result.left._tag, "ReviewCardUnavailable");
    assert.deepEqual(blocked.reviewEvents, []);
  }
  assert.ok(Either.isRight(attempt(input)));
});

await test("recall ordering falls back to due date for incomplete legacy schedules", () => {
  const input = {
    ...workspace([card("b", 2), card("a", 2)]),
    schedulerSettings: { requestRetention: 0.9, reviewOrder: "retrievability" as const },
  };
  assert.deepEqual(
    queue(input).cards.map((item) => item.id),
    ["a", "b"],
  );
});
