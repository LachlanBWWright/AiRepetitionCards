import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import {
  createAreaId,
  createAssessmentId,
  createReviewEventId,
  type LearningArea,
  type ReviewEvent,
} from "@recall/domain";
import { summarizeStudySession, formatReviewDelay } from "@recall/application";
import { newSchedule, scheduleReview, previewReviewSchedules } from "@recall/scheduler";

const now = new Date("2026-10-13T09:00:00.000Z");
const areaId = createAreaId("session-area");
const cardId = createAssessmentId("session-card");
const event: ReviewEvent = {
  id: createReviewEventId("session-review"),
  areaId,
  cardId,
  ratedAt: now.toISOString(),
  rating: "good",
  schedulerFamily: "fsrs",
  schedulerVersion: "ts-fsrs@5.4.2",
};
const area: LearningArea = {
  id: areaId,
  title: "Biology",
  color: "#3b82f6",
  cards: [
    {
      id: cardId,
      front: "Question",
      back: "Answer",
      objective: "Biology",
      schedule: newSchedule(now),
    },
  ],
};

await test("session summaries exclude other decks, deduplicate retries, and track relearning without changing history", () => {
  const events = [
    event,
    event,
    {
      ...event,
      id: createReviewEventId("other-review"),
      areaId: createAreaId("other-area"),
      rating: "again" as const,
    },
  ];
  const original = structuredClone({ area, events });
  const summary = summarizeStudySession(area, events, now.getTime());
  assert.equal(summary.reviewed, 1);
  assert.equal(summary.recalled, 1);
  assert.equal(summary.newCards, 1);
  const learningArea = {
    ...area,
    cards: area.cards.map((card) => ({
      ...card,
      schedule: scheduleReview(card.schedule, "again", now),
    })),
  };
  const later = summarizeStudySession(learningArea, [event], now.getTime() + 60_000);
  assert.equal(later.remaining, 1);
  assert.equal(later.learningCards, 1);
  assert.equal(later.reviewed, 1);
  assert.deepEqual({ area, events }, original);
});

await test("empty decks and future reviews give different completion information", () => {
  assert.equal(summarizeStudySession({ ...area, cards: [] }, [], now.getTime()).nextReviewAt, null);
  const future = {
    ...area,
    cards: area.cards.map((card) => ({
      ...card,
      schedule: scheduleReview(card.schedule, "easy", now),
    })),
  };
  const summary = summarizeStudySession(future, [event], now.getTime());
  assert.equal(summary.remaining, 0);
  assert.equal(summary.reviewed, 1);
  assert.equal(summary.nextReviewAt, Date.parse(future.cards[0]?.schedule.due ?? ""));
});

await test("rating previews match actual scheduling at the chosen retention, deterministically and without mutation", () => {
  const schedule = scheduleReview(newSchedule(now), "easy", now);
  const original = structuredClone(schedule);
  const parameters = { requestRetention: 0.97 };
  const preview = Effect.runSync(previewReviewSchedules(schedule, now, parameters));
  for (const rating of ["again", "hard", "good", "easy"] as const) {
    assert.deepEqual(preview[rating], scheduleReview(schedule, rating, now, parameters));
  }
  assert.deepEqual(Effect.runSync(previewReviewSchedules(schedule, now, parameters)), preview);
  assert.deepEqual(schedule, original);
  assert.equal(
    formatReviewDelay(new Date(now.getTime() + 60_000).toISOString(), now.getTime()),
    "1 min",
  );
  assert.equal(formatReviewDelay("invalid", now.getTime()), "Unavailable");
});
