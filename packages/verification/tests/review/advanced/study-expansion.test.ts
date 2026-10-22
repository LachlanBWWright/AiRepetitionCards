import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { createAreaId, createAssessmentId, effectiveReviewEvents } from "@recall/domain";
import {
  toKnowledgeArea,
  privateDeckHistory,
  exportPortableDeckPackage,
  importPortableDeckPackage,
  acceptPortableDeckImport,
  recordReview,
  undoReview,
  undoableReview,
  rebuildWorkspaceSchedules,
  studyQueue,
  studyCalendar,
  studyStatistics,
  simulateStudyWorkload,
  rebuildFilteredDeck,
  applyWorkspaceAuthoringCommand,
  tagHierarchy,
  browseStudyCards,
  relatedStudyCards,
} from "@recall/application";
import { prepareWorkspaceForSync, repairReviewSyncConflicts } from "@recall/sync-core";
import { workspace, card, areaId, now, day } from "./fixtures";
const first = <T>(values: readonly T[]): T => {
  const value = values[0];
  assert.ok(value);
  return value;
};
const at = new Date(now);
const rate = (input = workspace([card("a")]), eventId = "answer-1") =>
  Effect.runSync(
    recordReview({
      workspace: input,
      areaId,
      cardId: "a",
      eventId,
      rating: "good",
      ratedAt: at.toISOString(),
      studyDay: day,
    }),
  ).workspace;
const undo = (input: ReturnType<typeof workspace>, eventId = "answer-1", operationId = "undo-1") =>
  Effect.runSync(undoReview(input, { kind: "undo-review", eventId, operationId }, at));
await test("undo restores the original schedule, budget and statistics without deleting evidence", () => {
  const initial = {
    ...workspace([card("a")]),
    schedulerSettings: { requestRetention: 0.9, dailyNewLimit: 1 },
  };
  const reviewed = rate(initial);
  assert.equal(studyQueue(reviewed, first(reviewed.areas), now, day).cards.length, 0);
  const restored = undo(reviewed);
  assert.deepEqual(restored.areas[0]?.cards[0]?.schedule, initial.areas[0]?.cards[0]?.schedule);
  assert.equal(restored.reviewEvents?.length, 1);
  assert.equal(effectiveReviewEvents(restored).length, 0);
  assert.equal(studyQueue(restored, first(restored.areas), now, day).cards.length, 1);
  assert.equal(studyStatistics(restored, now, studyCalendar(now)).calendar.at(-1)?.reviews, 0);
  assert.deepEqual(Effect.runSync(rebuildWorkspaceSchedules(restored)), restored);
  assert.deepEqual(undo(restored), restored);
});
await test("undo works for imported nonempty schedules and rejects stale or missing snapshots", () => {
  const initial = workspace([
    { ...card("a", true), schedule: { ...card("a", true).schedule, due: at.toISOString() } },
  ]);
  assert.deepEqual(
    undo(rate(initial)).areas[0]?.cards[0]?.schedule,
    initial.areas[0]?.cards[0]?.schedule,
  );
  const reviewed = rate(workspace([card("a")]));
  assert.equal(undoableReview({ ...reviewed, reviewUndoStates: [] }), undefined);
  assert.ok(
    Either.isLeft(
      Effect.runSync(
        Effect.either(
          undoReview(
            reviewed,
            { kind: "undo-review", eventId: "missing", operationId: "undo" },
            at,
          ),
        ),
      ),
    ),
  );
});
await test("consecutive undos rebuild older answers and a later answer replays after correction", () => {
  const firstReview = rate();
  const second = Effect.runSync(
    recordReview({
      workspace: firstReview,
      areaId,
      cardId: "a",
      eventId: "answer-2",
      rating: "easy",
      ratedAt: new Date(now + 86400000).toISOString(),
    }),
  ).workspace;
  const restored = undo(second, "answer-2");
  assert.deepEqual(restored.areas[0]?.cards[0]?.schedule, firstReview.areas[0]?.cards[0]?.schedule);
  assert.equal(effectiveReviewEvents(undo(restored, "answer-1", "undo-2")).length, 0);
  const again = Effect.runSync(
    recordReview({
      workspace: restored,
      areaId,
      cardId: "a",
      eventId: "answer-3",
      rating: "good",
      ratedAt: new Date(now + 2 * 86400000).toISOString(),
    }),
  ).workspace;
  assert.deepEqual(Effect.runSync(rebuildWorkspaceSchedules(again)).areas, again.areas);
});
await test("identity normalization remaps suspensions, groups, manual changes and undo references", () => {
  const reviewed = rate();
  const current = {
    ...undo(reviewed),
    schedulerSettings: {
      requestRetention: 0.9,
      suspendedCardIds: [createAssessmentId("a")],
      areaParents: { [areaId]: "parent" },
      filteredDecks: [
        {
          id: "deck",
          name: "Deck",
          query: "",
          limit: 10,
          order: "due" as const,
          mode: "preview" as const,
          areaId,
        },
      ],
    },
  };
  const normalized = prepareWorkspaceForSync(current, () => "00000000-0000-4000-8000-000000000010");
  assert.equal(
    normalized.schedulerSettings?.suspendedCardIds?.[0],
    normalized.areas[0]?.cards[0]?.id,
  );
  assert.equal(normalized.schedulerSettings?.filteredDecks?.[0]?.areaId, normalized.areas[0]?.id);
  assert.equal(normalized.reviewCorrections?.[0]?.eventId, normalized.reviewEvents?.[0]?.id);
  assert.equal(normalized.reviewUndoStates?.[0]?.eventId, normalized.reviewEvents?.[0]?.id);
  const event = normalized.reviewEvents?.[0];
  assert.ok(event);
  const repaired = repairReviewSyncConflicts(
    normalized,
    [{ id: event.id, reason: "id-collision" }],
    () => "00000000-0000-4000-8000-000000000011",
  );
  assert.equal(repaired.reviewUndoStates?.[0]?.eventId, repaired.reviewEvents?.[0]?.id);
  assert.equal(effectiveReviewEvents(repaired).length, 0);
});
await test("workload simulation is deterministic, bounded and leaves live schedules unchanged", () => {
  const initial = workspace([card("a", true), card("b")]);
  const before = structuredClone(initial);
  const options = { days: 30, retention: 0.9, newPerDay: 2, reviewLimit: 20, additionalCards: 5 };
  const result = Effect.runSync(simulateStudyWorkload(initial, now, options));
  assert.deepEqual(Effect.runSync(simulateStudyWorkload(initial, now, options)), result);
  assert.ok(result.totalReviews > first(initial.areas).cards.length);
  assert.ok(result.days.every((day) => day.reviews <= 20 && day.introduced <= 2));
  assert.equal(result.timingEstimated, true);
  assert.deepEqual(initial, before);
  assert.ok(
    Either.isLeft(
      Effect.runSync(
        Effect.either(simulateStudyWorkload(initial, now, { ...options, retention: 2 })),
      ),
    ),
  );
});
await test("simulation uses recorded timing, excludes suspended cards and admits no new cards at zero", () => {
  const reviewed = rate();
  const timed = {
    ...reviewed,
    reviewEvents: reviewed.reviewEvents?.map((event) => ({ ...event, elapsedMs: 6000 })),
  };
  const result = Effect.runSync(
    simulateStudyWorkload(timed, now, {
      days: 10,
      retention: 0.9,
      newPerDay: 0,
      reviewLimit: 1,
      additionalCards: 10,
    }),
  );
  assert.equal(result.averageSeconds, 6);
  assert.equal(result.timingEstimated, false);
  assert.ok(result.days.every((day) => day.introduced === 0));
  const suspended = {
    ...workspace([card("a")]),
    schedulerSettings: { requestRetention: 0.9, suspendedCardIds: [createAssessmentId("a")] },
  };
  assert.equal(
    Effect.runSync(
      simulateStudyWorkload(suspended, now, {
        days: 5,
        retention: 0.9,
        newPerDay: 10,
        reviewLimit: 20,
        additionalCards: 0,
      }),
    ).totalReviews,
    0,
  );
});
await test("filtered collections rebuild globally while preserving original subject identities", () => {
  const initial = workspace([card("a")]);
  const firstArea = first(initial.areas);
  const other = { ...firstArea, id: createAreaId("other"), title: "Other", cards: [card("b")] };
  const global = { ...initial, areas: [firstArea, other] };
  const deck = {
    id: "exam",
    name: "Exam",
    query: "tag:biology",
    limit: 50,
    order: "due",
    mode: "reschedule",
  };
  const selected = Effect.runSync(rebuildFilteredDeck(global, deck, now, firstArea));
  assert.equal(selected.cards.length, 2);
  assert.equal(global.areas[1]?.cards[0]?.id, createAssessmentId("b"));
  const reviewed = Effect.runSync(
    applyWorkspaceAuthoringCommand(
      global,
      { kind: "rate-filtered-card", deck, cardId: "b", eventId: "filtered-answer", rating: "easy" },
      at,
    ),
  ).workspace;
  assert.equal(reviewed.reviewEvents?.[0]?.areaId, other.id);
  assert.ok(first(first(reviewed.areas.slice(1)).cards).schedule.reps > 0);
  assert.equal(global.reviewEvents?.length, 0);
  assert.ok(
    Either.isLeft(
      Effect.runSync(
        Effect.either(
          applyWorkspaceAuthoringCommand(
            global,
            {
              kind: "rate-filtered-card",
              deck: { ...deck, mode: "preview" },
              cardId: "b",
              eventId: "invalid",
              rating: "good",
            },
            at,
          ),
        ),
      ),
    ),
  );
});
await test("card browser sorts numerically, rolls up hierarchical tags and finds related cards", () => {
  const a = {
    ...card("a"),
    siblingId: "siblings",
    schedule: { ...card("a").schedule, scheduled_days: 20 },
  };
  const b = {
    ...card("b"),
    siblingId: "siblings",
    schedule: { ...card("b").schedule, scheduled_days: 3 },
  };
  const initial = workspace([a, b]);
  assert.equal(
    Effect.runSync(browseStudyCards(initial, "", now, "interval", false))[0]?.card.id,
    b.id,
  );
  assert.ok(tagHierarchy(initial).some((tag) => tag.tag === "exam" && tag.count === 2));
  assert.equal(relatedStudyCards(initial, a)[0]?.card.id, b.id);
});
await test("field replacement is atomic, retains schedules and creates restorable versions", () => {
  const initial = workspace([card("a"), card("b")]);
  const command = {
    kind: "replace-card-fields",
    areaId,
    cardIds: ["a", "b"],
    field: "front",
    find: "ATP",
    replacement: "ADP",
  };
  const result = Effect.runSync(applyWorkspaceAuthoringCommand(initial, command, at)).workspace;
  assert.ok(result.areas[0]?.cards.every((card) => card.front.includes("ADP")));
  assert.equal(result.cardVersions?.length, 2);
  assert.deepEqual(result.areas[0]?.cards[0]?.schedule, initial.areas[0]?.cards[0]?.schedule);
  const rejected = Effect.runSync(
    Effect.either(
      applyWorkspaceAuthoringCommand(
        initial,
        { ...command, find: "a ATP synthase", replacement: "" },
        at,
      ),
    ),
  );
  assert.ok(Either.isLeft(rejected));
  assert.ok(initial.areas[0]?.cards[0]?.front.includes("ATP"));
});

await test("private deck round-trip retains undo evidence and public copies exclude it", () => {
  const restored = undo(rate());
  const area = first(restored.areas);
  const document = Effect.runSync(toKnowledgeArea(area, true, true));
  const media = {
    get: () => Effect.succeed(null),
    put: () => Effect.void,
    delete: () => Effect.void,
    list: Effect.succeed([]),
  };
  const archive = Effect.runSync(
    exportPortableDeckPackage(document, media, privateDeckHistory(restored, area)),
  );
  const imported = Effect.runSync(importPortableDeckPackage(archive));
  const accepted = Effect.runSync(
    acceptPortableDeckImport({
      workspace: { schemaVersion: 1, areas: [], reviews: 0 },
      imported,
      color: "#123456",
      createId: () => "unused",
      now: at,
      restorePrivateHistory: true,
    }),
  );
  assert.equal(effectiveReviewEvents(accepted.workspace).length, 0);
  assert.equal(accepted.workspace.reviewEvents?.length, 1);
  assert.equal(
    Effect.runSync(rebuildWorkspaceSchedules(accepted.workspace)).areas[0]?.cards[0]?.schedule.reps,
    0,
  );
  const publicCopy = Effect.runSync(
    importPortableDeckPackage(Effect.runSync(exportPortableDeckPackage(document, media))),
  );
  assert.equal(publicCopy.privateHistory, undefined);
});
