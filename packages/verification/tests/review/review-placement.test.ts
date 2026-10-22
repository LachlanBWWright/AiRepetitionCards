import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import {
  AccountIdSchema,
  createAreaId,
  createAssessmentId,
  reviewEventsInArea,
  type Workspace,
} from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import { prepareWorkspaceForSync } from "@recall/sync-core";
import {
  applyWorkspaceAuthoringCommand,
  captureCardVersion,
  cardVersionHistory,
  restoreCardVersion,
  studyCalendar,
  studyStatistics,
  applyWorkspaceSyncChanges,
  deleteLearningArea,
  recordReview,
  rebuildWorkspaceSchedules,
  toKnowledgeArea,
} from "@recall/application";
import { privateDeckHistory } from "../../../application/src/interchange/portable/private-study-history";
import {
  exportPortableDeckPackage,
  importPortableDeckPackage,
  checkPortableDeckPrivateRestore,
} from "../../../application/src/interchange/portable/portable-deck-package";
const now = new Date("2026-10-22T00:00:00.000Z");
const sourceId = createAreaId("original-deck");
const targetId = createAreaId("target-deck");
const cardId = createAssessmentId("legacy-card");
const mediaStore = {
  get: () => Effect.succeed(null),
  put: () => Effect.void,
  delete: () => Effect.void,
  list: Effect.succeed([]),
};
function success<A, E>(effect: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(effect));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}
function fixture(): Workspace {
  return success(
    recordReview({
      workspace: {
        schemaVersion: 1,
        reviews: 0,
        areas: [
          {
            id: sourceId,
            title: "Original",
            color: "#123456",
            cards: [
              {
                id: cardId,
                front: "Question",
                back: "Answer",
                objective: "Recall",
                schedule: newSchedule(now),
              },
            ],
          },
          { id: targetId, title: "Target", color: "#123456", cards: [] },
        ],
      },
      areaId: sourceId,
      cardId,
      eventId: "review",
      rating: "good",
      ratedAt: now.toISOString(),
    }),
  ).workspace;
}
function move(workspace: Workspace): Workspace {
  return success(
    applyWorkspaceAuthoringCommand(
      workspace,
      {
        kind: "bulk-move-cards",
        areaId: sourceId,
        targetAreaId: targetId,
        cards: [{ cardId, newCardId: "ignored-legacy-copy-id" }],
      },
      now,
    ),
  ).workspace;
}
void test("moving a legacy reviewed identity before first sync preserves its normalized ID and all private references", () => {
  const original = fixture();
  const before = prepareWorkspaceForSync(original, () => "00000000-0000-4000-8000-000000000001");
  const after = prepareWorkspaceForSync(
    move(original),
    () => "00000000-0000-4000-8000-000000000001",
  );
  const originalId = before.areas[0]?.cards[0]?.id;
  assert.ok(originalId);
  assert.equal(after.areas[1]?.cards[0]?.id, originalId);
  assert.equal(after.reviewEvents?.[0]?.cardId, originalId);
  assert.equal(after.reviewEvents[0].areaId, before.areas[0]?.id);
  assert.equal(after.cardVersions?.[0]?.cardId, originalId);
  const card = after.areas[1].cards[0];
  assert.ok(card);
  assert.deepEqual(
    success(rebuildWorkspaceSchedules(after)).areas[1]?.cards[0]?.schedule,
    card.schedule,
  );
});
void test("canonical sync receipts may report current placement without rewriting historical review provenance", () => {
  const workspace = prepareWorkspaceForSync(
    {
      ...move(fixture()),
      syncOwnerId: Schema.decodeUnknownSync(AccountIdSchema)(
        "00000000-0000-4000-8000-000000000099",
      ),
    },
    () => "00000000-0000-4000-8000-000000000001",
  );
  const movedTargetId = workspace.areas[1]?.id;
  assert.ok(movedTargetId);
  const originalAreaId = workspace.areas[0]?.id;
  const event = workspace.reviewEvents?.[0];
  assert.ok(event);
  const changes = {
    baseline: workspace,
    acceptedIds: [event.id],
    cursor: "1",
    hasMore: false,
    uploadDeferred: false,
    pulledEvents: [{ ...event, areaId: movedTargetId }],
    pulledAreas: workspace.areas,
    deletedCardIds: [],
    syncedAreaTombstoneIds: [],
    pulledDeletedAreaIds: [],
    contentHashes: {},
    conflicts: [],
  };
  const synced = success(
    applyWorkspaceSyncChanges(workspace, changes, () => "00000000-0000-4000-8000-000000000002"),
  );
  assert.equal(synced.reviewEvents?.[0]?.areaId, originalAreaId);
  assert.equal(synced.pendingReviewEventIds?.length, 0);
  assert.deepEqual(synced.areas[1]?.cards[0]?.schedule, workspace.areas[1]?.cards[0]?.schedule);
});
void test("deleting the destination retains pending review identity even when its historical area differs", () => {
  const workspace = move(fixture());
  const deleted = success(deleteLearningArea(workspace, targetId, now)).workspace;
  assert.equal(deleted.retainedReviewAreas?.[0]?.id, targetId);
  assert.equal(deleted.retainedReviewAreas[0].cards[0]?.id, cardId);
  assert.deepEqual(deleted.reviewEvents, workspace.reviewEvents);
});
void test("private deck packages include moved card history with its original provenance and remain restorable", () => {
  const workspace = move(fixture());
  const target = workspace.areas[1];
  assert.ok(target);
  const history = privateDeckHistory(workspace, target);
  assert.equal(history.reviewEvents.length, 1);
  assert.equal(history.reviewEvents[0]?.areaId, sourceId);
  const document = success(toKnowledgeArea(target, true, true));
  const archive = success(exportPortableDeckPackage(document, mediaStore, history));
  const imported = success(importPortableDeckPackage(archive));
  assert.equal(imported.privateHistory?.reviewEvents[0]?.areaId, sourceId);
  assert.equal(imported.privateHistory.cardVersions[0]?.reason, "move");
  assert.equal(imported.privateHistory.cardVersions[0].movedToAreaId, targetId);
  assert.deepEqual(
    checkPortableDeckPrivateRestore(imported, { schemaVersion: 1, reviews: 0, areas: [] }),
    { accepted: true },
  );
});

void test("an unrelated archived legacy alias never contributes history to the one surviving card with that alias", () => {
  const original = fixture();
  const source = original.areas[0];
  const card = source?.cards[0];
  assert.ok(source && card);
  const captured = captureCardVersion(original, source, card, "delete", now);
  const fresh = { ...card, schedule: newSchedule(now) };
  const unrelated: Workspace = {
    ...captured,
    areas: [{ id: targetId, title: "Unrelated", color: "#123456", cards: [fresh] }],
  };
  assert.equal(reviewEventsInArea(unrelated, targetId).length, 0);
  const replayed = success(rebuildWorkspaceSchedules(unrelated));
  assert.deepEqual(replayed.areas[0]?.cards[0]?.schedule, fresh.schedule);
  const stats = studyStatistics(unrelated, now.getTime(), studyCalendar(now.getTime()), targetId);
  assert.equal(
    stats.calendar.reduce((total, day) => total + day.reviews, 0),
    0,
  );
  const normalized = prepareWorkspaceForSync(
    unrelated,
    () => "00000000-0000-4000-8000-000000000001",
  );
  assert.notEqual(normalized.areas[0]?.cards[0]?.id, normalized.reviewEvents?.[0]?.cardId);
  assert.equal(normalized.reviewEvents?.[0]?.cardId, normalized.cardVersions?.[0]?.cardId);
});

void test("restoring authored content from before a move keeps the current deck, card identity and schedule", () => {
  const workspace = move(fixture());
  const history = cardVersionHistory(workspace, targetId, cardId);
  const version = history[0];
  assert.ok(version);
  assert.equal(version.areaId, sourceId);
  const updated: Workspace = {
    ...workspace,
    areas: workspace.areas.map((area) => ({
      ...area,
      cards: area.cards.map((card) => ({ ...card, front: "Later edited question" })),
    })),
  };
  const restored = success(
    restoreCardVersion(
      updated,
      {
        areaId: targetId,
        cardId,
        versionId: version.id,
      },
      now,
    ),
  );
  assert.equal(restored.areas[0]?.cards.length, 0);
  assert.equal(restored.areas[1]?.cards[0]?.id, cardId);
  assert.equal(restored.areas[1].cards[0].front, "Question");
  assert.deepEqual(restored.areas[1].cards[0].schedule, workspace.areas[1]?.cards[0]?.schedule);
  assert.deepEqual(restored.reviewEvents, workspace.reviewEvents);
});
