import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Effect, Either, Schema } from "effect";
import {
  AccountIdSchema,
  createAreaId,
  createCardId,
  createDeviceId,
  MediaIdSchema,
  createObjectiveId,
  createReviewEventId,
  type KnowledgeArea,
  type ReviewEvent,
  type Workspace,
} from "@recall/domain";
import {
  SyncChangeSchema,
  SyncPushRequestSchema,
  WorkspaceContentPushRequestSchema,
  WorkspaceReviewIdentitiesRequestSchema,
  WorkspaceAreaTombstoneRequestSchema,
  type WorkspaceSnapshot,
} from "@recall/contracts";
import {
  deleteLearningArea,
  deleteStudyCard,
  syncWorkspace,
  applyWorkspaceSyncChanges,
  type WorkspaceSyncInput,
  type WorkspaceSyncRequest,
  type WorkspaceSyncResponse,
  type WorkspaceSyncTransportFailure,
} from "@recall/application";
import { newSchedule, schedulerParameterSetId } from "@recall/scheduler";

const time = "2026-10-03T12:00:00.000Z";
const uuid = (value: number): string =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const owner = Schema.decodeUnknownSync(AccountIdSchema)(uuid(7));
const areaId = createAreaId(uuid(1));
const objectiveId = createObjectiveId(uuid(2));
const cardId = createCardId(uuid(3));
const deviceId = createDeviceId(uuid(4));
function review(id = 5, reviewedCard = cardId, raw = time): ReviewEvent {
  return {
    id: createReviewEventId(uuid(id)),
    areaId,
    cardId: reviewedCard,
    ratedAt: raw,
    reviewedAtDevice: raw,
    effectiveReviewedAt: raw,
    deviceId,
    deviceSequence: id,
    baseReviewEventId: null,
    rating: "good",
    schedulerFamily: "fsrs",
    schedulerVersion: "ts-fsrs@5.4.2",
    schedulerParameterSetId: schedulerParameterSetId({ requestRetention: 0.9 }),
    previousStateHash: null,
    elapsedMs: 1000,
  };
}
function workspace(events: readonly ReviewEvent[] = [review()]): Workspace {
  return {
    schemaVersion: 1,
    syncDeviceId: deviceId,
    reviews: events.length,
    reviewEvents: events,
    pendingReviewEventIds: events.map((event) => event.id),
    syncCursor: "0",
    areas: [
      {
        id: areaId,
        title: "Offline area",
        color: "#123456",
        objectives: [{ id: objectiveId, title: "Goal", description: null, prerequisiteIds: [] }],
        cards: [
          {
            id: cardId,
            front: "Q",
            back: "A",
            objective: "Goal",
            objectiveIds: [objectiveId],
            schedule: newSchedule(new Date(time)),
          },
        ],
      },
    ],
  };
}
function decode<A, I>(schema: Schema.Schema<A, I>, value: unknown): A {
  const result = Schema.decodeUnknownEither(schema)(value);
  assert.ok(Either.isRight(result));
  return result.right;
}

/** An isolated owner-scoped server model: mutations persist even when a response is lost. */
function server(
  options: {
    readonly ownerId?: string;
    readonly corruptReceipt?: boolean;
    readonly accountChangesAtContent?: boolean;
  } = {},
) {
  const remoteOwner = options.ownerId ?? owner;
  const documents = new Map<string, WorkspaceSnapshot["areas"][number]>();
  const identities = new Map<
    string,
    { readonly id: string; readonly areaId: string; readonly deleted: boolean }
  >();
  const reviews = new Map<string, ReviewEvent>();
  const changes: Array<typeof SyncChangeSchema.Type> = [];
  const deletedAreas = new Set<string>();
  const requests: WorkspaceSyncRequest[] = [];
  const uploads: string[] = [];
  const postedDocuments: Array<readonly KnowledgeArea[]> = [];
  let checkpointed: Workspace | undefined;
  let loseNextReviewResponse = false;
  let failNextTombstone = false;
  const recordDocument = (document: KnowledgeArea, color: string): void => {
    documents.set(document.id, {
      document,
      color,
      contentHash: createHash("sha256").update(JSON.stringify(document)).digest("hex"),
    });
    for (const card of document.cards)
      identities.set(card.id, { id: card.id, areaId: document.id, deleted: false });
  };
  const snapshot = (): unknown => ({
    schemaVersion: 1,
    ownerId: remoteOwner,
    areas: [...documents.values()],
    deletedAreaIds: [...deletedAreas],
  });
  const response = (body: unknown, status = 200): WorkspaceSyncResponse => ({ status, body });
  const transport: WorkspaceSyncInput["transport"] = (request) =>
    Effect.suspend(() => {
      requests.push(request);
      if (request.method === "POST") {
        assert.ok(checkpointed, "durable owner checkpoint precedes every cloud mutation");
        assert.equal(request.headers?.["x-recall-workspace-owner"], remoteOwner);
      }
      if (request.path === "/api/v1/workspace" && request.method === "GET")
        return Effect.succeed(response(snapshot()));
      if (request.path === "/api/v1/workspace/review-identities") {
        const body = decode(WorkspaceReviewIdentitiesRequestSchema, request.body);
        return Effect.succeed(
          response({
            schemaVersion: 1,
            ownerId: remoteOwner,
            reviewCards: body.cardIds.flatMap((id) => {
              const identity = identities.get(id);
              return identity ? [identity] : [];
            }),
          }),
        );
      }
      if (request.path === "/api/v1/workspace" && request.method === "POST") {
        if (options.accountChangesAtContent)
          return Effect.succeed(response({ error: "workspace-account-changed" }, 409));
        const body = decode(WorkspaceContentPushRequestSchema, request.body);
        if (body.tombstones.length > 0 && failNextTombstone) {
          failNextTombstone = false;
          return Effect.fail({
            _tag: "WorkspaceSyncTransportFailure",
          } satisfies WorkspaceSyncTransportFailure);
        }
        postedDocuments.push(body.areas.map((area) => area.document));
        for (const area of body.areas) recordDocument(area.document, area.color);
        for (const tombstone of body.tombstones) {
          const area = documents.get(tombstone.areaId);
          if (area)
            recordDocument(
              {
                ...area.document,
                cards: area.document.cards.filter((card) => card.id !== tombstone.cardId),
              },
              area.color,
            );
          identities.set(tombstone.cardId, {
            id: tombstone.cardId,
            areaId: tombstone.areaId,
            deleted: true,
          });
        }
        return Effect.succeed(
          response({
            schemaVersion: 1,
            syncedAreas: body.areas.length,
            syncedCards: body.areas.reduce((count, area) => count + area.document.cards.length, 0),
          }),
        );
      }
      if (request.path === "/api/v1/sync" && request.method === "POST") {
        const body = decode(SyncPushRequestSchema, request.body);
        for (const operation of body.operations) {
          const identity = identities.get(operation.cardId);
          assert.ok(identity, "every pushed review identity was provisioned first");
          if (!reviews.has(operation.id)) {
            const event: ReviewEvent = {
              ...operation,
              areaId: createAreaId(identity.areaId),
              deviceId: body.deviceId,
              ratedAt: time,
              effectiveReviewedAt: time,
            };
            reviews.set(event.id, event);
            changes.push({
              sequence: String(changes.length + 1),
              operationId: event.id,
              entityType: "review_event",
              entityId: event.id,
              operation: "upsert",
              payload: event,
              createdAt: time,
            });
          }
        }
        if (loseNextReviewResponse) {
          loseNextReviewResponse = false;
          return Effect.fail({
            _tag: "WorkspaceSyncTransportFailure",
          } satisfies WorkspaceSyncTransportFailure);
        }
        const acceptedReviewEvents = body.operations.flatMap((operation) => {
          const event = reviews.get(operation.id);
          return event ? [options.corruptReceipt ? { ...event, elapsedMs: 9999 } : event] : [];
        });
        return Effect.succeed(
          response({
            schemaVersion: 1,
            acceptedIds: body.operations.map((operation) => operation.id),
            acceptedReviewEvents,
            conflicts: [],
            cursor: String(changes.length),
          }),
        );
      }
      if (request.path === "/api/v1/workspace/area-tombstones") {
        const body = decode(WorkspaceAreaTombstoneRequestSchema, request.body);
        for (const area of body.areaTombstones) {
          documents.delete(area.areaId);
          deletedAreas.add(area.areaId);
        }
        return Effect.succeed(
          response({ deletedAreaIds: body.areaTombstones.map((area) => area.areaId) }),
        );
      }
      if (request.path.startsWith("/api/v1/sync?cursor=")) {
        const cursor = new URLSearchParams(request.path.split("?")[1]).get("cursor") ?? "0";
        const page = changes.filter((change) => BigInt(change.sequence) > BigInt(cursor));
        return Effect.succeed(
          response({
            schemaVersion: 1,
            cursor: page.at(-1)?.sequence ?? cursor,
            hasMore: false,
            changes: page,
          }),
        );
      }
      assert.fail(`Unexpected transport request ${request.path}`);
    });
  const input = (local: Workspace, checkpointFails = false): WorkspaceSyncInput => ({
    workspace: local,
    now: new Date(time),
    createId: () => uuid(9),
    transport,
    checkpoint: (bound) =>
      checkpointFails
        ? Effect.fail({ _tag: "WorkspaceSyncCheckpointFailure" })
        : Effect.sync(() => {
            checkpointed = bound;
            return bound;
          }),
    mediaStore: {
      get: () => Effect.succeed(null),
      put: () => Effect.void,
      delete: () => Effect.void,
      list: Effect.succeed([]),
    },
    mediaGatewayForOwner: (boundOwner) => {
      assert.equal(boundOwner, remoteOwner);
      assert.equal(checkpointed?.syncOwnerId, remoteOwner);
      return {
        upload: (asset) =>
          Effect.sync(() => {
            assert.ok(checkpointed);
            uploads.push(asset.reference.id);
          }),
        read: () => Effect.succeed(null),
      };
    },
  });
  return {
    input,
    requests,
    reviews,
    documents,
    identities,
    postedDocuments,
    uploads,
    loseReviewResponse: () => {
      loseNextReviewResponse = true;
    },
    failTombstone: () => {
      failNextTombstone = true;
    },
    getCheckpoint: () => checkpointed,
  };
}

await test("fresh ownership is durably checkpointed before content, media or review mutations", () => {
  const remote = server();
  const local = workspace();
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const reference = {
    id: decode(MediaIdSchema, createHash("sha256").update(bytes).digest("hex")),
    mimeType: "image/png" as const,
    byteLength: bytes.length,
  };
  const mediaWorkspace = {
    ...local,
    areas: local.areas.map((area) => ({
      ...area,
      cards: area.cards.map((card) => ({ ...card, media: [reference] })),
    })),
  };
  const input = remote.input(mediaWorkspace);
  const result = Effect.runSync(
    syncWorkspace({
      ...input,
      mediaStore: { ...input.mediaStore, get: () => Effect.succeed({ reference, bytes }) },
    }),
  );
  assert.equal(result._tag, "Synced");
  assert.equal(remote.getCheckpoint()?.syncOwnerId, owner);
  assert.ok(remote.uploads.length > 0);
  assert.equal(remote.reviews.size, 1);
  assert.equal(local.syncOwnerId, undefined);
});

await test("failed owner checkpoint and another canonical account stop all cloud writes", () => {
  const failed = server();
  const failedResult = Effect.runSync(
    Effect.either(syncWorkspace(failed.input(workspace(), true))),
  );
  assert.ok(Either.isLeft(failedResult));
  assert.equal(failedResult.left.reason, "ownership-checkpoint");
  assert.equal(failed.requests.filter((request) => request.method === "POST").length, 0);
  const different = server({ ownerId: uuid(8) });
  const mismatch = Effect.runSync(
    Effect.either(syncWorkspace(different.input({ ...workspace(), syncOwnerId: owner }))),
  );
  assert.ok(Either.isLeft(mismatch));
  assert.equal(mismatch.left.reason, "account-mismatch");
  assert.equal(different.getCheckpoint(), undefined);
  assert.equal(different.requests.filter((request) => request.method === "POST").length, 0);
});

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
  const liveCardId = createCardId(uuid(6));
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

await test("an account change at the mutation boundary rejects upload after binding without discarding offline data", () => {
  const local = workspace();
  const remote = server({ accountChangesAtContent: true });
  const result = Effect.runSync(Effect.either(syncWorkspace(remote.input(local))));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, "account-changed");
  assert.equal(remote.getCheckpoint()?.syncOwnerId, owner);
  assert.equal(remote.documents.size, 0);
  assert.equal(remote.reviews.size, 0);
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
