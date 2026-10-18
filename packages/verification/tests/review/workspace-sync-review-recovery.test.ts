import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { createAssessmentId } from "@recall/domain";
import {
  applyWorkspaceSyncChanges,
  deleteLearningArea,
  deleteStudyCard,
  syncWorkspace,
} from "@recall/application";
import {
  areaId,
  cardId,
  owner,
  review,
  server,
  time,
  uuid,
  workspace,
} from "../workspace/workspace-sync-fixtures.js";

await test("lost review response retries exactly once and canonical receipt works past the original cursor", () => {
  const remote = server();
  const local = workspace([review(5, cardId, "2027-01-01T00:00:00.000Z")]);
  remote.loseReviewResponse();
  const lost = Effect.runSync(Effect.either(syncWorkspace(remote.input(local))));
  assert.ok(Either.isLeft(lost));
  assert.equal(lost.left.reason, "request");
  assert.equal(local.pendingReviewEventIds?.length, 1);
  assert.equal(remote.reviews.size, 1);
  const retry = Effect.runSync(
    syncWorkspace(remote.input({ ...local, syncOwnerId: owner, syncCursor: "1" })),
  );
  assert.equal(retry._tag, "Synced");
  assert.equal(remote.reviews.size, 1);
  assert.equal(retry.workspace.reviewEvents?.length, 1);
  const acknowledged = retry.workspace.reviewEvents[0];
  assert.ok(acknowledged);
  assert.equal(acknowledged.effectiveReviewedAt, time);
  assert.equal(acknowledged.reviewedAtDevice, "2027-01-01T00:00:00.000Z");
  assert.equal(retry.workspace.pendingReviewEventIds?.length, 0);
  assert.equal(retry.workspace.areas[0]?.cards[0]?.schedule.last_review, time);
  const applied = Effect.runSync(applyWorkspaceSyncChanges(retry.workspace, retry, () => uuid(9)));
  assert.deepEqual(applied, retry.workspace);
});

await test("mixed deleted/live review batch provisions both identities before upload and releases only deleted evidence", () => {
  const liveCardId = createAssessmentId(uuid(6));
  const local = workspace([review(), review(10, liveCardId)]);
  const original = local.areas[0];
  assert.ok(original);
  const firstCard = original.cards[0];
  assert.ok(firstCard);
  const mixed = {
    ...local,
    areas: [
      {
        ...original,
        cards: [...original.cards, { ...firstCard, id: liveCardId, front: "Live replacement" }],
      },
    ],
  };
  const deleted = Effect.runSync(deleteStudyCard(mixed, { areaId, cardId }));
  assert.equal(deleted.retainedReviewAreas?.[0]?.cards.length, 1);
  const remote = server();
  const result = Effect.runSync(syncWorkspace(remote.input(deleted)));
  assert.equal(result._tag, "Synced");
  const provisioned = remote.postedDocuments[0]?.[0];
  assert.ok(provisioned);
  assert.deepEqual(
    new Set(provisioned.cards.map((card) => card.id)),
    new Set([cardId, liveCardId]),
  );
  assert.equal(remote.reviews.size, 2);
  assert.equal(remote.identities.get(cardId)?.deleted, true);
  assert.equal(result.workspace.reviewEvents?.length, 2);
  assert.deepEqual(
    result.workspace.areas[0]?.cards.map((card) => card.id),
    [liveCardId],
  );
  assert.equal(result.workspace.retainedReviewAreas?.length, 0);
  assert.equal(result.workspace.pendingReviewEventIds?.length, 0);
});

await test("failed post-ACK tombstone keeps local history/evidence and a retry finishes deletion without duplicate reviews", () => {
  const deleted = Effect.runSync(deleteLearningArea(workspace(), areaId)).workspace;
  const remote = server();
  remote.failTombstone();
  const partial = Effect.runSync(Effect.either(syncWorkspace(remote.input(deleted))));
  assert.ok(Either.isLeft(partial));
  assert.equal(partial.left.reason, "request");
  assert.equal(remote.reviews.size, 1);
  assert.equal(deleted.reviewEvents?.length, 1);
  assert.equal(deleted.pendingReviewEventIds?.length, 1);
  assert.equal(deleted.retainedReviewAreas?.length, 1);
  assert.equal(deleted.deletedAreas?.length, 1);
  const result = Effect.runSync(syncWorkspace(remote.input(deleted)));
  assert.equal(result._tag, "Synced");
  assert.equal(remote.reviews.size, 1);
  assert.equal(remote.documents.size, 0);
  assert.equal(result.workspace.areas.length, 0);
  assert.equal(result.workspace.reviewEvents?.length, 1);
  assert.equal(result.workspace.pendingReviewEventIds?.length, 0);
  assert.equal(result.workspace.retainedReviewAreas?.length, 0);
  assert.equal(result.workspace.deletedAreas?.[0]?.synced, true);
});

await test("immutable canonical receipt collision preserves the pending local review", () => {
  const local = workspace();
  const remote = server({ corruptReceipt: true });
  const result = Effect.runSync(Effect.either(syncWorkspace(remote.input(local))));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, "reviews");
  assert.equal(local.reviewEvents?.[0]?.elapsedMs, 1000);
  assert.equal(local.pendingReviewEventIds?.length, 1);
});

await test("legacy missing deleted content fails explicitly before content or review mutation and preserves the outbox", () => {
  const deleted = Effect.runSync(deleteStudyCard(workspace(), { areaId, cardId }));
  const legacy = { ...deleted, retainedReviewAreas: [] };
  const remote = server();
  const result = Effect.runSync(Effect.either(syncWorkspace(remote.input(legacy))));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, "deleted-review-content-missing");
  assert.equal(remote.documents.size, 0);
  assert.equal(remote.reviews.size, 0);
  assert.equal(legacy.reviewEvents?.length, 1);
  assert.equal(legacy.pendingReviewEventIds?.length, 1);
  assert.equal(legacy.deletedCards?.length, 1);
});
