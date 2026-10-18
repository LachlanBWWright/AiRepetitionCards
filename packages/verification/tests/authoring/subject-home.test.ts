import assert from "node:assert/strict";
import test from "node:test";
import { createAreaId, createReviewEventId } from "@recall/domain";
import { summarizeSubjects } from "@recall/application";
import { searchFixture, uuid } from "../fixtures/search-workspace";
const now = Date.parse("2026-10-18T00:00:00Z");
const seed = searchFixture().workspace.areas[0];
assert.ok(seed);
const seedCard = seed.cards[0];
assert.ok(seedCard);
const subject = (id: number, title: string, times: readonly number[]) => ({
  ...seed,
  id: createAreaId(uuid(id)),
  title,
  cards: times.map((time) => ({
    ...seedCard,
    schedule: { ...seedCard.schedule, due: new Date(time).toISOString() },
  })),
});
void test("daily priority puts scheduled reviews before AI follow-ups, then orders by overdue urgency", () => {
  const areas = [
    subject(10, "Follow-up", []),
    subject(11, "Recently due", [now - 1]),
    subject(12, "Overdue", [now - 100000]),
    subject(13, "Caught up", [now + 1]),
  ] as const;
  const before = JSON.stringify(areas);
  assert.deepEqual(
    summarizeSubjects(areas, [], now, "daily", [areas[0].id]).map((row) => row.area.title),
    ["Overdue", "Recently due", "Follow-up", "Caught up"],
  );
  assert.equal(JSON.stringify(areas), before);
});
void test("subject sorts preserve caught-up and empty areas and support name filtering", () => {
  const areas = [
    subject(10, "Zoology", [now, now]),
    subject(11, "Algebra", []),
    subject(12, "Biology", [now]),
  ] as const;
  assert.deepEqual(
    summarizeSubjects(areas, [], now, "name").map((row) => row.area.title),
    ["Algebra", "Biology", "Zoology"],
  );
  assert.deepEqual(
    summarizeSubjects(areas, [], now, "due").map((row) => row.due),
    [2, 1, 0],
  );
  assert.deepEqual(
    summarizeSubjects(areas, [], now, "daily", [], "  ALG ").map((row) => row.area.title),
    ["Algebra"],
  );
  assert.deepEqual(summarizeSubjects([], [], now, "daily"), []);
});
void test("recently studied uses review events rather than modifying scheduling state", () => {
  const card = seed.cards[0];
  assert.ok(card);
  const event = {
    id: createReviewEventId(uuid(50)),
    areaId: seed.id,
    cardId: card.id,
    rating: "good" as const,
    ratedAt: new Date(now).toISOString(),
    schedulerFamily: "fsrs" as const,
    schedulerVersion: "1",
  };
  const areas = [subject(10, "Algebra", []), subject(11, "Zoology", [])] as const;
  const events = [{ ...event, areaId: areas[1].id, ratedAt: new Date(now).toISOString() }];
  assert.equal(summarizeSubjects(areas, events, now, "recent")[0]?.area.title, "Zoology");
});
