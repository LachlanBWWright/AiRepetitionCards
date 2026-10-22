import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either, Schema } from "effect";
import {
  ImportedScheduleSchema,
  StudySyncDocumentSchema,
  WorkspaceSchema,
  createAreaId,
  createAssessmentId,
  createReviewEventId,
  type Assessment,
  type Workspace,
} from "@recall/domain";
import { newSchedule, scheduleReview } from "@recall/scheduler";
import {
  applyWorkspaceAuthoringCommand,
  captureCardVersion,
  restoreCardVersion,
  rebuildWorkspaceSchedules,
} from "@recall/application";
const now = new Date("2026-10-20T00:00:00.000Z");
const areaId = createAreaId("imported-source");
const targetId = createAreaId("copy-target");
const cardId = createAssessmentId("imported-card");
const eventId = createReviewEventId("imported-review");
const schedule = scheduleReview(
  newSchedule(new Date("2026-10-18T00:00:00.000Z")),
  "good",
  new Date("2026-10-19T00:00:00.000Z"),
);
function workspace(): Workspace {
  const card: Assessment = {
    id: cardId,
    front: "Question",
    back: "Answer",
    objective: "Recall",
    schedule,
    noteId: "note",
    templateId: "forward",
    siblingId: "related",
    importedSchedule: { schedule, reviewEventIds: [eventId] },
  };
  return {
    schemaVersion: 1,
    reviews: 0,
    areas: [
      { id: areaId, title: "Imported", color: "#123456", cards: [card] },
      { id: targetId, title: "Destination", color: "#123456", cards: [] },
    ],
  };
}
await test("private baseline decoding rejects invalid dates, numeric state and duplicate exclusions", () => {
  const invalidSchedules = [
    { ...schedule, due: "invalid" },
    { ...schedule, due: "2026-02-30T00:00:00.000Z" },
    { ...schedule, last_review: "" },
    { ...schedule, last_review: "2026-10-19T00:00:00" },
    ...[
      "stability",
      "difficulty",
      "elapsed_days",
      "scheduled_days",
      "learning_steps",
      "reps",
      "lapses",
    ].flatMap((key) => [-1, Infinity, NaN].map((value) => ({ ...schedule, [key]: value }))),
  ];
  for (const value of invalidSchedules)
    assert.equal(
      Either.isLeft(
        Schema.decodeUnknownEither(ImportedScheduleSchema)({ schedule: value, reviewEventIds: [] }),
      ),
      true,
    );
  assert.equal(
    Either.isLeft(
      Schema.decodeUnknownEither(ImportedScheduleSchema)({
        schedule,
        reviewEventIds: [eventId, eventId],
      }),
    ),
    true,
  );
  assert.equal(
    Either.isLeft(
      Schema.decodeUnknownEither(ImportedScheduleSchema)({
        schedule,
        reviewEventIds: Array.from({ length: 100001 }, (_, index) => `review-${String(index)}`),
      }),
    ),
    true,
  );
});
await test("duplicate imported baseline identities fail workspace and sync document boundaries", () => {
  const baseline = { areaId, cardId, baseline: { schedule, reviewEventIds: [eventId] } };
  const document = {
    settings: { requestRetention: 0.9 },
    adjustments: [],
    corrections: [],
    undoStates: [],
    importedSchedules: [baseline, { ...baseline, areaId: targetId }],
  };
  assert.equal(Either.isLeft(Schema.decodeUnknownEither(StudySyncDocumentSchema)(document)), true);
  assert.equal(
    Either.isLeft(
      Schema.decodeUnknownEither(WorkspaceSchema)({
        ...workspace(),
        importedScheduleBaselines: document.importedSchedules,
      }),
    ),
    true,
  );
});
await test("bulk moves preserve imported baselines and history while detaching source-note links", () => {
  const result = Effect.runSync(
    applyWorkspaceAuthoringCommand(
      workspace(),
      {
        kind: "bulk-move-cards",
        areaId,
        targetAreaId: targetId,
        cards: [{ cardId, newCardId: "independent-moved-card" }],
      },
      now,
    ),
  ).workspace;
  const rebuilt = Effect.runSync(rebuildWorkspaceSchedules(result));
  const copy = rebuilt.areas[1]?.cards[0];
  assert.ok(copy);
  assert.deepEqual(copy.schedule, workspace().areas[0]?.cards[0]?.schedule);
  assert.deepEqual(copy.importedSchedule, workspace().areas[0]?.cards[0]?.importedSchedule);
  assert.equal(copy.id, cardId);
  assert.equal(copy.noteId, undefined);
  assert.equal(copy.templateId, undefined);
  assert.equal(copy.siblingId, undefined);
});
await test("restore-as-copy detaches baseline links while ordinary restore preserves them", () => {
  const original = workspace();
  const area = original.areas[0];
  const card = area?.cards[0];
  assert.ok(area && card);
  const captured = captureCardVersion(original, area, card, "edit", now);
  const version = captured.cardVersions?.[0];
  assert.ok(version);
  const command = { areaId, cardId, versionId: version.id };
  const ordinary = Effect.runSync(restoreCardVersion(captured, command, now));
  assert.deepEqual(ordinary.areas[0]?.cards[0]?.importedSchedule, card.importedSchedule);
  assert.equal(ordinary.areas[0]?.cards[0]?.noteId, "note");
  const deleted = {
    ...captured,
    syncCursor: "1",
    deletedCards: [{ areaId, cardId }],
    areas: captured.areas.map((item) => ({ ...item, cards: [] })),
  };
  const restored = Effect.runSync(restoreCardVersion(deleted, command, now));
  const rebuilt = Effect.runSync(rebuildWorkspaceSchedules(restored));
  const copy = rebuilt.areas[0]?.cards[0];
  assert.ok(copy);
  assert.notEqual(copy.id, cardId);
  assert.deepEqual(copy.schedule, newSchedule(now));
  assert.equal(copy.importedSchedule, undefined);
  assert.equal(copy.noteId, undefined);
  assert.equal(copy.templateId, undefined);
  assert.equal(copy.siblingId, undefined);
});
