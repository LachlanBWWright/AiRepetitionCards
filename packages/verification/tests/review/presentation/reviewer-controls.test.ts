import assert from "node:assert/strict";
import { test } from "node:test";
import { Either, Schema } from "effect";
import {
  defaultReviewerSettings,
  ReviewerSettingsSchema,
  type Assessment,
  type Workspace,
  createAreaId,
  createAssessmentId,
  createReviewEventId,
} from "@recall/domain";
import {
  reviewerKeyAction,
  reviewerSwipeAction,
  reviewerGestureAction,
  reviewerTimedAction,
  studyQueue,
  presetPolicy,
} from "@recall/application";
import { newSchedule } from "@recall/scheduler";

await test("custom shortcuts are phase-aware and duplicate keys fail validation", () => {
  const settings = {
    ...defaultReviewerSettings,
    shortcuts: { reveal: "r", again: "a", hard: "h", good: "g", easy: "e" },
  };
  assert.equal(reviewerKeyAction("G", false, settings), undefined);
  assert.equal(reviewerKeyAction("R", false, settings), "reveal");
  assert.equal(reviewerKeyAction("Enter", false, settings), "reveal");
  assert.equal(reviewerKeyAction("G", true, settings), "good");
  assert.equal(reviewerKeyAction("1", true, settings), undefined);
  assert.ok(
    Either.isLeft(
      Schema.decodeUnknownEither(ReviewerSettingsSchema)({
        ...settings,
        shortcuts: { ...settings.shortcuts, easy: "G" },
      }),
    ),
  );
  assert.ok(
    Either.isLeft(
      Schema.decodeUnknownEither(ReviewerSettingsSchema)({ ...settings, answerSeconds: -1 }),
    ),
  );
});

await test("auto advance defaults off and never rates the hidden answer", () => {
  assert.equal(reviewerTimedAction(600_000, false, defaultReviewerSettings), undefined);
  assert.equal(reviewerTimedAction(600_000, true, defaultReviewerSettings), undefined);
  const settings = { ...defaultReviewerSettings, questionSeconds: 5, answerSeconds: 10 };
  assert.equal(reviewerTimedAction(4999, false, settings), undefined);
  assert.equal(reviewerTimedAction(5000, false, settings), "reveal");
  assert.equal(reviewerTimedAction(9999, true, settings), undefined);
  assert.equal(reviewerTimedAction(10000, true, settings), "again");
});

await test("swipes require explicit enablement and an intentional horizontal gesture", () => {
  assert.equal(reviewerSwipeAction(120, 0, true, defaultReviewerSettings), undefined);
  const settings = { ...defaultReviewerSettings, swipeEnabled: true };
  assert.equal(reviewerSwipeAction(120, 0, false, settings), undefined);
  assert.equal(reviewerSwipeAction(120, 0, true, settings), "good");
  assert.equal(reviewerSwipeAction(-120, 0, true, settings), "again");
  assert.equal(reviewerSwipeAction(120, 100, true, settings), undefined);
  assert.equal(reviewerSwipeAction(30, 0, true, settings), undefined);
  assert.equal(reviewerSwipeAction(120, 0, false, { ...settings, swipeRight: "reveal" }), "reveal");
});

await test("sibling bury settings distinguish new, review, and learning while preserving retries", () => {
  const at = new Date("2026-10-22T12:00:00Z");
  const areaId = createAreaId("bury-area");
  const card = (id: string, state: Assessment["schedule"]["state"]): Assessment => ({
    id: createAssessmentId(id),
    front: id,
    back: "Answer",
    objective: "Recall",
    siblingId: "note",
    schedule: { ...newSchedule(at), state },
  });
  const area = {
    id: areaId,
    title: "Deck",
    color: "#123456",
    cards: [
      card("seen", 1),
      card("new", 0),
      card("review", 2),
      card("learning", 1),
      card("relearning", 3),
    ],
  };
  const workspace: Workspace = {
    schemaVersion: 1,
    reviews: 1,
    areas: [area],
    reviewEvents: [
      {
        id: createReviewEventId("seen-event"),
        cardId: createAssessmentId("seen"),
        areaId,
        ratedAt: at.toISOString(),
        rating: "good",
        schedulerFamily: "fsrs",
        schedulerVersion: "test",
      },
    ],
    schedulerSettings: {
      requestRetention: 0.9,
      burySiblings: false,
      buryNewSiblings: true,
      buryReviewSiblings: false,
      buryLearningSiblings: true,
      reviewer: defaultReviewerSettings,
    },
  };
  const result = studyQueue(workspace, area, at.getTime(), {
    startsAt: at.getTime() - 1000,
    endsAt: at.getTime() + 1000,
  });
  assert.deepEqual(
    result.cards.map((item) => item.id),
    ["seen", "review"],
  );
  assert.equal(result.buriedCount, 3);
  assert.equal(
    "reviewer" in presetPolicy(workspace.schedulerSettings ?? { requestRetention: 0.9 }),
    false,
  );
});

await test("gestures cannot reveal or rate a replacement card or changed answer side", () => {
  const settings = { ...defaultReviewerSettings, swipeEnabled: true, swipeLeft: "reveal" as const };
  const question = { cardId: "first", revealed: false };
  const answer = { ...question, revealed: true };
  const gesture = { startedOn: question, current: question, dx: -120, dy: 0 };
  assert.equal(reviewerGestureAction(gesture, settings), "reveal");
  assert.equal(reviewerGestureAction({ ...gesture, current: answer }, settings), undefined);
  assert.equal(
    reviewerGestureAction({ ...gesture, current: { ...question, cardId: "next" } }, settings),
    undefined,
  );
  const rating = { startedOn: answer, current: answer, dx: 120, dy: 0 };
  assert.equal(reviewerGestureAction(rating, settings), "good");
  assert.equal(
    reviewerGestureAction({ ...rating, current: { ...answer, cardId: "next" } }, settings),
    undefined,
  );
  assert.equal(reviewerGestureAction({ ...rating, current: question }, settings), undefined);
});
