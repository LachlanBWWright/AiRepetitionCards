import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import {
  searchStudyCards,
  searchWorkspace,
  filteredStudyArea,
  studyQueue,
  updateSchedulerSettings,
} from "@recall/application";
import { createAssessmentId } from "@recall/domain";
import { workspace, card, review, now, day } from "./fixtures";

await test("card search supports quoted phrases, field filters, boolean groups, exclusions and numeric comparisons", () => {
  const initial = { ...workspace(), reviewEvents: [review(1, now - 86_400_000, "b", "again")] };
  const find = (query: string) =>
    Effect.runSync(searchStudyCards(initial, query, now)).map(({ card: item }) => item.id);
  assert.deepEqual(find('deck:"Cell biology" tag:exam::* front:"ATP synthase"'), ["a", "b"]);
  assert.deepEqual(find("(is:new OR rated:7:again) -is:suspended"), ["a", "b"]);
  assert.deepEqual(find("is:review interval:>1 -is:new"), ["b"]);
  assert.deepEqual(find('back:"cellular respiration" AND is:new'), ["a"]);
  assert.deepEqual(
    searchWorkspace(initial, [], "is:new tag:biology", { now }).map((entry) => entry.target.kind),
    ["card"],
  );
});

await test("malformed and unsupported searches fail explicitly instead of selecting all cards", () => {
  for (const query of [
    'tag:"open',
    "(is:new",
    "is:new OR",
    "missing:field",
    "interval:banana",
    "is:unknown",
    "rated:3:wrong",
    "(((((((((is:new)))))))))",
  ])
    assert.ok(
      Either.isLeft(Effect.runSync(Effect.either(searchStudyCards(workspace(), query, now)))),
    );
});

await test("filtered practice is bounded and excludes suspension without changing schedules", () => {
  const initial = {
    ...workspace([card("a"), card("b"), card("c")]),
    schedulerSettings: { requestRetention: 0.9, suspendedCardIds: [createAssessmentId("b")] },
  };
  const original = structuredClone(initial);
  const area = initial.areas[0];
  assert.ok(area);
  const filtered = Effect.runSync(filteredStudyArea(initial, area, "tag:biology", now, 1));
  assert.deepEqual(
    filtered.cards.map((item) => item.id),
    ["a"],
  );
  assert.deepEqual(initial, original);
});

await test("saved searches persist and an explicit scheduled filter can be cleared", () => {
  const initial = workspace([card("a"), { ...card("b"), tags: ["other"] }]);
  const saved = Effect.runSync(
    updateSchedulerSettings(initial, {
      requestRetention: 0.9,
      savedSearches: [{ id: "s", name: "Biology", query: "tag:biology" }],
      activeStudyQuery: "tag:biology",
    }),
  );
  const area = saved.areas[0];
  assert.ok(area);
  assert.deepEqual(
    studyQueue(saved, area, now, day).cards.map((item) => item.id),
    ["a"],
  );
  assert.equal(studyQueue(saved, area, now, day).filteredCount, 1);
  assert.equal(saved.schedulerSettings?.savedSearches?.[0]?.query, "tag:biology");
  assert.equal(
    studyQueue({ ...saved, schedulerSettings: { requestRetention: 0.9 } }, area, now, day).cards
      .length,
    2,
  );
});
