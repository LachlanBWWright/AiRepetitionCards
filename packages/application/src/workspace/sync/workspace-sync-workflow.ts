import { areaMediaReferences } from "../media/media-references";
import { Effect, Either, Schema } from "effect";
import { syncStudyDocument } from "./study-sync";
import {
  SyncPullResponseSchema,
  SyncReviewOperationSchema,
  type SyncReviewOperation,
} from "@recall/contracts";
import {
  ReviewEventSchema,
  AccountIdSchema,
  createAreaId,
  createAssessmentId,
  type AreaId,
  type AssessmentId,
  type ReviewEvent,
} from "@recall/domain";
import { isValidSyncPullPage, orderReviewEvents, prepareWorkspaceForSync } from "@recall/sync-core";
import { syncWorkspaceMedia } from "../media/workspace-media-sync";
import { bindWorkspaceOwner } from "../../account/workspace-account";
import {
  retainedReviewContent,
  validateRetainedReviewContent,
} from "../../review/review-deletion-retention";
import { applyWorkspaceSyncChanges } from "./workspace-sync-reconciliation";
import type {
  WorkspaceSyncFailure,
  WorkspaceSyncInput,
  WorkspaceSyncRequest,
  WorkspaceSyncResult,
  WorkspaceSyncChanges,
} from "./workspace-sync";
import {
  failure,
  successful,
  snapshotFrom,
  snapshotAreas,
  hashesFrom,
} from "./workspace-sync-snapshots";
import { pushWorkspaceChanges } from "./workspace-sync-push";
/** Network ordering is shared; callers persist success or explicitly approve a conflict preview. */
export function syncWorkspace(
  input: WorkspaceSyncInput,
): Effect.Effect<WorkspaceSyncResult, WorkspaceSyncFailure> {
  return Effect.gen(function* () {
    if (!Number.isFinite(input.now.getTime())) return yield* Effect.fail(failure("invalid-time"));
    let ownerId: string | undefined;
    if (input.expectedOwnerId !== undefined) {
      const expected = Schema.decodeUnknownEither(AccountIdSchema)(input.expectedOwnerId);
      if (Either.isLeft(expected)) return yield* Effect.fail(failure("account-changed"));
      ownerId = expected.right;
    }
    const request = (value: WorkspaceSyncRequest) =>
      input
        .transport({
          ...value,
          ...(ownerId
            ? { headers: { ...value.headers, "x-recall-workspace-owner": ownerId } }
            : {}),
        })
        .pipe(
          Effect.mapError(() => failure("request")),
          Effect.flatMap((response) =>
            response.status === 409 &&
            typeof response.body === "object" &&
            response.body !== null &&
            "error" in response.body &&
            response.body.error === "workspace-account-changed"
              ? Effect.fail(failure("account-changed"))
              : Effect.succeed(response),
          ),
        );
    const before = yield* request({ path: "/api/v1/workspace", method: "GET" }).pipe(
      Effect.flatMap(snapshotFrom),
    );
    if (ownerId !== undefined && ownerId !== before.ownerId)
      return yield* Effect.fail(failure("account-changed"));
    ownerId = before.ownerId;
    const bound = yield* bindWorkspaceOwner(input.workspace, ownerId, input.adoptLegacyOwner);
    const checkpoint = yield* input
      .checkpoint(bound)
      .pipe(Effect.mapError(() => failure("ownership-checkpoint")));
    if (checkpoint.syncOwnerId !== ownerId)
      return yield* Effect.fail(failure("ownership-checkpoint"));
    const prepared = prepareWorkspaceForSync(checkpoint, input.createId);
    yield* validateRetainedReviewContent(prepared).pipe(
      Effect.mapError(() => failure("deleted-review-content-missing")),
    );
    const mediaGateway = input.mediaGatewayForOwner(ownerId);
    const pending = new Set(prepared.pendingReviewEventIds ?? []);
    const resumingPull = prepared.syncHasMore === true;
    const pendingEvents = (prepared.reviewEvents ?? []).filter((event) => pending.has(event.id));
    const reviewBatch = resumingPull
      ? []
      : [...pendingEvents]
          .sort(
            (left, right) =>
              (left.deviceSequence ?? 0) - (right.deviceSequence ?? 0) ||
              left.id.localeCompare(right.id),
          )
          .slice(0, 100);
    const operations: SyncReviewOperation[] = [];
    for (const event of orderReviewEvents(reviewBatch).events) {
      if (!pending.has(event.id) || !event.deviceSequence || !event.deviceId) continue;
      const operation = Schema.decodeUnknownEither(SyncReviewOperationSchema)({
        id: event.id,
        cardId: event.cardId,
        deviceSequence: event.deviceSequence,
        baseReviewEventId: event.baseReviewEventId ?? null,
        reviewedAtDevice: event.reviewedAtDevice ?? event.ratedAt,
        effectiveReviewedAt: event.effectiveReviewedAt ?? event.ratedAt,
        rating: event.rating,
        elapsedMs: event.elapsedMs ?? null,
        schedulerFamily: event.schedulerFamily,
        schedulerVersion: event.schedulerVersion,
        schedulerParameterSetId: event.schedulerParameterSetId ?? null,
        previousStateHash: event.previousStateHash ?? null,
      });
      if (Either.isLeft(operation)) return yield* Effect.fail(failure("reviews"));
      operations.push(operation.right);
    }
    const sentOperations = operations.slice(0, 100);
    let uploadDeferred = resumingPull;
    const protectedCardIds = new Set(pendingEvents.map((event) => event.cardId));
    const deletionCards = new Map((prepared.deletedCards ?? []).map((item) => [item.cardId, item]));
    for (const area of retainedReviewContent(prepared))
      if (prepared.deletedAreas?.some((item) => item.areaId === area.id))
        for (const card of area.cards)
          deletionCards.set(card.id, { areaId: area.id, cardId: card.id });
    const safeCardTombstones = [...deletionCards.values()].filter(
      (item) => !protectedCardIds.has(item.cardId),
    );
    if (safeCardTombstones.length < deletionCards.size) uploadDeferred = true;
    const pushed = yield* pushWorkspaceChanges({
      input,
      request,
      prepared,
      before,
      mediaGateway,
      reviewBatch,
      pendingEvents,
      pending,
      sentOperations,
      deletionCards,
      safeCardTombstones,
      protectedCardIds,
      ownerId,
      resumingPull,
      uploadDeferred,
    });
    if (pushed._tag === "ContentConflict") return pushed;
    const {
      acceptedIds,
      conflicts,
      syncedAreaTombstoneIds,
      confirmedCardIds,
      canonicalAcceptedEvents,
    } = pushed;
    uploadDeferred = pushed.uploadDeferred;

    let cursor = prepared.syncCursor ?? "0";
    const pulledEvents: ReviewEvent[] = [...canonicalAcceptedEvents];
    const deletedCardIds: AssessmentId[] = [...confirmedCardIds];
    const pulledDeletedAreaIds: AreaId[] = [];
    let completed = false;
    for (let page = 0; page < 100; page += 1) {
      const response = yield* request({
        path: `/api/v1/sync?cursor=${encodeURIComponent(cursor)}`,
        method: "GET",
      });
      const pull = Schema.decodeUnknownEither(SyncPullResponseSchema)(response.body);
      if (!successful(response) || Either.isLeft(pull) || !isValidSyncPullPage(pull.right, cursor))
        return yield* Effect.fail(failure("reviews"));
      for (const change of pull.right.changes) {
        if (change.entityType === "card") deletedCardIds.push(createAssessmentId(change.entityId));
        if (change.entityType === "area") pulledDeletedAreaIds.push(createAreaId(change.entityId));
        if (change.entityType !== "review_event") continue;
        const event = Schema.decodeUnknownEither(ReviewEventSchema)(change.payload);
        if (Either.isLeft(event)) return yield* Effect.fail(failure("reviews"));
        pulledEvents.push(event.right);
      }
      cursor = pull.right.cursor;
      if (!pull.right.hasMore) {
        completed = true;
        break;
      }
    }
    if (!completed || resumingPull) {
      // Checkpoint only content already known locally. A current snapshot can omit cards whose
      // tombstone lies beyond this cursor; importing that snapshot now would skip their replay.
      // Resumed pulls also retain local edits; the next normal sync uploads them before hydration.
      const changes: WorkspaceSyncChanges = {
        baseline: prepared,
        acceptedIds,
        conflicts,
        cursor,
        hasMore: !completed,
        uploadDeferred,
        pulledEvents,
        pulledAreas: prepared.areas,
        deletedCardIds,
        syncedAreaTombstoneIds,
        pulledDeletedAreaIds,
        contentHashes: {},
      };
      const workspace = yield* applyWorkspaceSyncChanges(prepared, changes, input.createId);
      return {
        _tag: "Synced",
        workspace,
        remainingPendingReviews: workspace.pendingReviewEventIds?.length ?? 0,
        ...changes,
      } as const;
    }
    const after = yield* request({ path: "/api/v1/workspace", method: "GET" }).pipe(
      Effect.flatMap(snapshotFrom),
    );
    if (after.ownerId !== ownerId) return yield* Effect.fail(failure("account-changed"));
    yield* syncWorkspaceMedia(
      input.mediaStore,
      mediaGateway,
      after.areas.flatMap((area) => areaMediaReferences(area.document)),
    ).pipe(
      Effect.mapError((error) =>
        failure(error.reason === "account-changed" ? "account-changed" : "media"),
      ),
    );
    for (const areaId of after.deletedAreaIds)
      if (!pulledDeletedAreaIds.includes(areaId)) pulledDeletedAreaIds.push(areaId);
    const pulledAreas = yield* snapshotAreas(after, input, prepared);
    const study =
      conflicts.length || pendingEvents.some((event) => !acceptedIds.includes(event.id))
        ? undefined
        : yield* syncStudyDocument(prepared, request);
    const changes: WorkspaceSyncChanges = {
      ...(study ? { studyDocument: study.document, studyConflict: study.conflict } : {}),
      baseline: prepared,
      acceptedIds,
      conflicts,
      cursor,
      hasMore: false,
      uploadDeferred,
      pulledEvents,
      pulledAreas,
      deletedCardIds,
      syncedAreaTombstoneIds,
      pulledDeletedAreaIds,
      contentHashes: hashesFrom(after),
    };
    const workspace = yield* applyWorkspaceSyncChanges(prepared, changes, input.createId);
    return {
      _tag: "Synced",
      workspace,
      remainingPendingReviews: workspace.pendingReviewEventIds?.length ?? 0,
      ...changes,
    } as const;
  });
}
