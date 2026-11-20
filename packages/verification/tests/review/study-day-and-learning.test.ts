import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import { SchedulerSettingsSchema, createReviewEventId } from "@recall/domain";
import {
  localStudyDay,
  studyQueue,
  recordReview,
  undoReview,
  suspensionSettings,
  studyCalendar,
} from "@recall/application";
import { workspace, card, now, areaId } from "./advanced/fixtures";

function firstArea(value: ReturnType<typeof workspace>) {
  const area = value.areas[0];
  assert.ok(area);
  return area;
}

await test("study-day rollover and statistics share DST-aware local boundaries", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const at = new Date(2026, 2, 8, 3, 30).getTime();
    const day = localStudyDay(at, 4);
    assert.equal(new Date(day.startsAt).getDate(), 7);
    assert.equal(new Date(day.endsAt).getHours(), 4);
    assert.equal(day.endsAt - day.startsAt, 23 * 3_600_000);
    const after = localStudyDay(new Date(2026, 2, 8, 4).getTime(), 4);
    assert.equal(after.startsAt, day.endsAt);
    assert.equal(studyCalendar(at, 1, 1, 4).past[0]?.startsAt, day.startsAt);
    const autumn = localStudyDay(new Date(2026, 10, 1, 3, 30).getTime(), 4);
    assert.equal(autumn.endsAt - autumn.startsAt, 25 * 3_600_000);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

await test("learning look-ahead waits for ordinary due work and respects suspension, filters and the configured window", () => {
  const learning: ReturnType<typeof card> = {
    ...card("learning"),
    schedule: {
      ...card("learning").schedule,
      state: 1,
      due: new Date(now + 5 * 60_000).toISOString(),
    },
  };
  const initial = workspace([learning]);
  const day = localStudyDay(now);
  assert.equal(studyQueue(initial, firstArea(initial), now, day).cards.length, 0);
  const enabled = {
    ...initial,
    schedulerSettings: {
      ...(initial.schedulerSettings ?? { requestRetention: 0.9 }),
      learnAheadMinutes: 10,
    },
  };
  const queue = studyQueue(enabled, firstArea(enabled), now, day);
  assert.equal(queue.cards[0]?.id, learning.id);
  assert.equal(queue.learningAheadCount, 1);
  const due = card("due");
  const withDue = { ...enabled, areas: [{ ...firstArea(enabled), cards: [learning, due] }] };
  assert.deepEqual(
    studyQueue(withDue, firstArea(withDue), now, day).cards.map((item) => item.id),
    [due.id],
  );
  for (const policy of [
    { learnAheadMinutes: 4 },
    { learnAheadMinutes: 10, suspendedCardIds: [learning.id] },
    { learnAheadMinutes: 10, activeStudyQuery: "is:review" },
  ]) {
    const blocked = { ...enabled, schedulerSettings: { ...enabled.schedulerSettings, ...policy } };
    assert.equal(studyQueue(blocked, firstArea(blocked), now, day).cards.length, 0);
  }
});

await test("automatic leech suspension is opt-in, preserves answers and is reversible by review undo", () => {
  const original = card("leech", true);
  const leech: ReturnType<typeof card> = {
    ...original,
    schedule: { ...original.schedule, state: 2, lapses: 7, due: new Date(now).toISOString() },
  };
  const base = workspace([leech]);
  const input = {
    areaId,
    cardId: leech.id,
    rating: "again" as const,
    eventId: createReviewEventId("leech-answer"),
    ratedAt: new Date(now).toISOString(),
  };
  const manual = Effect.runSync(recordReview({ ...input, workspace: base })).workspace;
  assert.equal(manual.schedulerSettings?.suspendedCardIds?.includes(leech.id) ?? false, false);
  const enabled = {
    ...base,
    schedulerSettings: {
      ...(base.schedulerSettings ?? { requestRetention: 0.9 }),
      leechAction: "suspend" as const,
    },
  };
  const reviewed = Effect.runSync(recordReview({ ...input, workspace: enabled })).workspace;
  assert.equal(reviewed.reviewEvents?.length, 1);
  assert.ok(reviewed.schedulerSettings?.suspendedCardIds?.includes(leech.id));
  const undo = Effect.runSync(
    undoReview(
      reviewed,
      { kind: "undo-review", eventId: input.eventId, operationId: "undo-leech" },
      new Date(now + 1000),
    ),
  );
  assert.equal(undo.schedulerSettings?.suspendedCardIds?.includes(leech.id), false);
  assert.equal(undo.reviewEvents?.length, 1);
  assert.equal(undo.reviewCorrections?.length, 1);
  const resumed = { ...reviewed, schedulerSettings: suspensionSettings(reviewed, leech.id) };
  const manuallySuspended = {
    ...resumed,
    schedulerSettings: suspensionSettings(resumed, leech.id),
  };
  const explicit = Effect.runSync(
    undoReview(
      manuallySuspended,
      { kind: "undo-review", eventId: input.eventId, operationId: "undo-explicit" },
      new Date(now + 1000),
    ),
  );
  assert.ok(explicit.schedulerSettings?.suspendedCardIds?.includes(leech.id));
});

await test("new scheduling controls reject invalid boundary values", () => {
  for (const value of [
    { studyDayStartHour: 24 },
    { learnAheadMinutes: -1 },
    { learnAheadMinutes: 61 },
    { leechAction: "delete" },
  ])
    assert.ok(
      Either.isLeft(
        Schema.decodeUnknownEither(SchedulerSettingsSchema)({ requestRetention: 0.9, ...value }),
      ),
    );
});
