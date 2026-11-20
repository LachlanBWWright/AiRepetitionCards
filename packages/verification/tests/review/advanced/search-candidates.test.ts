import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { createStudySearchIndex, searchStudyCards } from "@recall/application";
import { createAssessmentId } from "@recall/domain";
import { searchCandidateRows } from "../../../../application/src/review/search/search-candidates";
import { card, workspace, now } from "./fixtures";

await test("large collection index prunes text searches without changing Boolean/substring semantics", () => {
  const initial = workspace();
  const large = {
    ...initial,
    areas: initial.areas.map((area) => ({
      ...area,
      cards: Array.from({ length: 50_000 }, (_, row) => ({
        ...card("entry"),
        id: createAssessmentId(`entry-${String(row)}`),
        front: row === 49_999 ? "Rare mitochondrion ＡＴＰ" : `Ordinary question ${String(row)}`,
      })),
    })),
  };
  const index = createStudySearchIndex(large);
  assert.deepEqual(
    searchCandidateRows({ kind: "term", value: "mitochondrion" }, index.postings),
    [49_999],
  );
  for (const query of [
    "mitochondrion",
    "ＡＴＰ",
    "chond",
    "question -mitochondrion",
    '(mitochondrion OR "question 42")',
    "NOT mitochondrion",
    "is:new OR mitochondrion",
    "mi",
    "",
  ]) {
    const indexed = Effect.runSync(searchStudyCards(large, query, now, undefined, index));
    const reference = Effect.runSync(
      searchStudyCards(large, `(${query || "is:new"}) OR interval:>999999`, now, undefined, index),
    );
    if (query)
      assert.deepEqual(
        indexed.map(({ card }) => card.id),
        reference.map(({ card }) => card.id),
      );
  }
});

await test("schedule-only revisions reuse text postings; content edits invalidate them", () => {
  const initial = workspace();
  const index = createStudySearchIndex(initial);
  const reviewed = {
    ...initial,
    areas: initial.areas.map((area) => ({
      ...area,
      cards: area.cards.map((entry) => ({
        ...entry,
        schedule: { ...entry.schedule, reps: entry.schedule.reps + 1 },
      })),
    })),
  };
  const next = createStudySearchIndex(reviewed, index);
  assert.equal(next.postings, index.postings);
  const edited = {
    ...reviewed,
    areas: reviewed.areas.map((area) => ({
      ...area,
      cards: area.cards.map((entry) => ({ ...entry, front: "unique mitochondrion" })),
    })),
  };
  const updated = createStudySearchIndex(edited, next);
  assert.notEqual(updated.postings, next.postings);
  assert.equal(
    Effect.runSync(searchStudyCards(edited, "mitochondrion", now, undefined, updated)).length,
    updated.entries.length,
  );
});
