import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import {
  syncWorkspace,
  updateSchedulerSettings,
  applyWorkspaceAuthoringCommand,
  recordReview,
  undoReview,
} from "@recall/application";
import { effectiveReviewEvents } from "@recall/domain";
import { server, workspace, areaId, cardId, time } from "./workspace-sync-fixtures";
const sync = (remote: ReturnType<typeof server>, local: ReturnType<typeof workspace>) => {
  const result = Effect.runSync(syncWorkspace(remote.input(local)));
  assert.ok(result._tag === "Synced");
  return result.workspace;
};
await test("backend study sync carries presets, suspensions, searches and manual scheduling to another device", () => {
  const remote = server();
  const first = sync(remote, workspace([]));
  const settings = {
    requestRetention: 0.94,
    dailyNewLimit: 5,
    suspendedCardIds: [cardId],
    presets: [{ id: "exam", name: "Exam", settings: { requestRetention: 0.95 } }],
    savedSearches: [{ id: "search", name: "New", query: "is:new" }],
  };
  const changed = Effect.runSync(updateSchedulerSettings(first, settings));
  const adjusted = Effect.runSync(
    applyWorkspaceAuthoringCommand(
      changed,
      {
        kind: "administer-cards",
        areaId,
        cardIds: [cardId],
        operationId: "manual",
        action: "due",
        due: "2026-11-01T12:00:00.000Z",
      },
      new Date(time),
    ),
  ).workspace;
  sync(remote, adjusted);
  const other = sync(remote, workspace([]));
  assert.deepEqual(other.schedulerSettings, settings);
  assert.equal(other.scheduleAdjustments?.length, 1);
  assert.equal(other.areas[0]?.cards[0]?.schedule.due, "2026-11-01T12:00:00.000Z");
});
await test("disjoint device edits merge while overlapping settings retain both versions for an explicit choice", () => {
  const remote = server();
  const first = sync(remote, workspace([]));
  const second = sync(remote, workspace([]));
  const changed = sync(
    remote,
    Effect.runSync(updateSchedulerSettings(first, { requestRetention: 0.95 })),
  );
  const merged = sync(
    remote,
    Effect.runSync(updateSchedulerSettings(second, { requestRetention: 0.9, dailyNewLimit: 7 })),
  );
  assert.equal(merged.schedulerSettings?.requestRetention, 0.95);
  assert.equal(merged.schedulerSettings.dailyNewLimit, 7);
  assert.equal(merged.studySettingsConflict, undefined);
  const conflicted = sync(
    remote,
    Effect.runSync(updateSchedulerSettings(changed, { requestRetention: 0.85 })),
  );
  // The second device changed only dailyNewLimit; retention still has one writer.
  assert.equal(conflicted.studySettingsConflict, undefined);
  const overlapping = sync(
    remote,
    Effect.runSync(
      updateSchedulerSettings(merged, { ...merged.schedulerSettings, requestRetention: 0.8 }),
    ),
  );
  assert.equal(overlapping.schedulerSettings?.requestRetention, 0.85);
  assert.equal(overlapping.studySettingsConflict?.local.requestRetention, 0.8);
  const resolved = Effect.runSync(
    applyWorkspaceAuthoringCommand(
      overlapping,
      { kind: "resolve-study-settings", choice: "local" },
      new Date(time),
    ),
  ).workspace;
  assert.equal(sync(remote, resolved).schedulerSettings?.requestRetention, 0.8);
});
await test("undo corrections synchronize and restore the original schedule on another device", () => {
  const remote = server();
  const initial = sync(remote, workspace([]));
  const reviewed = Effect.runSync(
    recordReview({
      workspace: initial,
      areaId,
      cardId,
      eventId: "00000000-0000-4000-8000-000000000015",
      ratedAt: time,
      rating: "good",
    }),
  ).workspace;
  const sent = sync(remote, reviewed);
  const undone = Effect.runSync(
    undoReview(
      sent,
      { kind: "undo-review", eventId: reviewed.reviewEvents?.[0]?.id, operationId: "undo-answer" },
      new Date(time),
    ),
  );
  sync(remote, undone);
  const other = sync(remote, workspace([]));
  assert.equal(other.reviewEvents?.length, 1);
  assert.equal(effectiveReviewEvents(other).length, 0);
  assert.equal(other.areas[0]?.cards[0]?.schedule.reps, 0);
});
