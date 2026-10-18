import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Effect, Either, Schema } from "effect";
import {
  AccountIdSchema,
  createAreaId,
  createAssessmentId,
  createDeviceId,
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
  type WorkspaceSyncInput,
  type WorkspaceSyncRequest,
  type WorkspaceSyncResponse,
  type WorkspaceSyncTransportFailure,
} from "@recall/application";
import { newSchedule, schedulerParameterSetId } from "@recall/scheduler";

export const time = "2026-10-03T12:00:00.000Z";
export const uuid = (value: number): string =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
export const owner = Schema.decodeUnknownSync(AccountIdSchema)(uuid(7));
export const areaId = createAreaId(uuid(1));
const objectiveId = createObjectiveId(uuid(2));
export const cardId = createAssessmentId(uuid(3));
const deviceId = createDeviceId(uuid(4));
export function review(id = 5, reviewedCard = cardId, raw = time): ReviewEvent {
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
export function workspace(events: readonly ReviewEvent[] = [review()]): Workspace {
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
export function decode<A, I>(schema: Schema.Schema<A, I>, value: unknown): A {
  const result = Schema.decodeUnknownEither(schema)(value);
  assert.ok(Either.isRight(result));
  return result.right;
}

/** An isolated owner-scoped server model: mutations persist even when a response is lost. */
export function server(
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
