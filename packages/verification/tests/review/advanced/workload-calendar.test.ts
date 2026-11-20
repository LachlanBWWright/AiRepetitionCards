import assert from "node:assert/strict";
import test from "node:test";
import { createAreaId, createReviewEventId } from "@recall/domain";
import { Effect } from "effect";
import { compareStudyWorkload, simulateStudyWorkload } from "@recall/application";
import { card, workspace, now, areaId } from "./fixtures";

const options = { days: 3, retention: 0.9, newPerDay: 10, reviewLimit: 100, additionalCards: 0 };

await test("simulator buries note siblings until the next study day without blocking retries", () => {
  const initial = workspace([
    { ...card("one"), siblingId: "shared" },
    { ...card("two"), siblingId: "shared" },
  ]);
  const result = Effect.runSync(simulateStudyWorkload(initial, now, options));
  assert.equal(result.days[0]?.introduced, 1);
  assert.equal(result.days[0].buried, 1);
  assert.equal(result.days[1]?.introduced, 1);
  assert.ok(result.days[0].reviews > 1);
  const unburied = Effect.runSync(
    simulateStudyWorkload(
      { ...initial, schedulerSettings: { requestRetention: 0.9, buryNewSiblings: false } },
      now,
      options,
    ),
  );
  assert.equal(unburied.days[0]?.introduced, 2);
});

await test("simulation starts with a partial day and crosses a daylight-saving calendar boundary", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const result = Effect.runSync(
      simulateStudyWorkload(workspace([]), Date.parse("2026-03-07T17:00:00Z"), options),
    );
    assert.equal(result.days[0]?.endsAt, "2026-03-08T05:00:00.000Z");
    assert.equal(result.days[1]?.startsAt, "2026-03-08T05:00:00.000Z");
    assert.equal(result.days[1].endsAt, "2026-03-09T04:00:00.000Z");
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

await test("study-day rollover hour and retention comparison are deterministic and never rewrite schedules", () => {
  const initial = {
    ...workspace([card("one", true)]),
    schedulerSettings: { requestRetention: 0.9, studyDayStartHour: 4 },
  };
  const original = structuredClone(initial);
  const comparisons = Effect.runSync(compareStudyWorkload(initial, now, options));
  assert.deepEqual(
    comparisons.map((item) => item.targetRetention),
    [0.8, 0.9, 0.95],
  );
  assert.equal(comparisons[0]?.days[0]?.endsAt, "2026-10-19T04:00:00.000Z");
  assert.deepEqual(Effect.runSync(compareStudyWorkload(initial, now, options)), comparisons);
  assert.deepEqual(initial, original);
});

await test("siblings of real answers made today stay buried in the first scenario day", () => {
  const first = { ...card("one", true), siblingId: "shared" };
  const second = { ...card("two"), siblingId: "shared" };
  const initial = workspace([first, second]);
  const event = {
    id: createReviewEventId("answered-today"),
    areaId,
    cardId: first.id,
    rating: "good" as const,
    ratedAt: new Date(now).toISOString(),
    schedulerFamily: "fsrs" as const,
    schedulerVersion: "ts-fsrs@5.4.2" as const,
  };
  const result = Effect.runSync(
    simulateStudyWorkload({ ...initial, reviewEvents: [event] }, now, options),
  );
  assert.equal(result.days[0]?.introduced, 0);
  assert.equal(result.days[0].buried, 1);
  assert.equal(result.days[1]?.introduced, 1);
});

await test("same card identifiers in separate subjects retain separate simulation states", () => {
  const initial = workspace([card("one")]);
  const first = initial.areas[0];
  assert.ok(first);
  const result = Effect.runSync(
    simulateStudyWorkload(
      {
        ...initial,
        areas: [
          first,
          {
            ...first,
            id: createAreaId("second-subject"),
          },
        ],
      },
      now,
      options,
    ),
  );
  assert.equal(result.days[0]?.introduced, 2);
});

await test("buried new siblings do not consume introduction slots for unrelated notes", () => {
  const initial = workspace([
    { ...card("one"), siblingId: "shared" },
    { ...card("two"), siblingId: "shared" },
    card("unrelated"),
  ]);
  const result = Effect.runSync(simulateStudyWorkload(initial, now, { ...options, newPerDay: 2 }));
  assert.equal(result.days[0]?.introduced, 2);
  assert.equal(result.days[0].buried, 1);
});

await test("reduced-load weekday scheduling affects projected daily reviews", () => {
  const initial = workspace([card("one", true), card("two", true)]);
  const scenario = { ...options, days: 30 };
  const baseline = Effect.runSync(simulateStudyWorkload(initial, now, scenario));
  const reduced = Effect.runSync(
    simulateStudyWorkload(
      {
        ...initial,
        schedulerSettings: { requestRetention: 0.9, easyDays: [0, 1, 2, 3, 4, 5], timeZone: "UTC" },
      },
      now,
      scenario,
    ),
  );
  assert.notDeepEqual(reduced.days, baseline.days);
  assert.deepEqual(
    Effect.runSync(
      simulateStudyWorkload(
        {
          ...initial,
          schedulerSettings: {
            requestRetention: 0.9,
            easyDays: [0, 1, 2, 3, 4, 5],
            timeZone: "UTC",
          },
        },
        now,
        scenario,
      ),
    ),
    reduced,
  );
});
