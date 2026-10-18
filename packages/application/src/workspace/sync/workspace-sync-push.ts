import { Effect, Either, Schema } from "effect";
import {
  SyncPushResponseSchema,
  WorkspaceContentPushResponseSchema,
  WorkspaceReviewIdentitiesResponseSchema,
  type SyncPushResponse,
  type SyncReviewOperation,
} from "@recall/contracts";
import {
  createAreaId,
  createAssessmentId,
  type AreaId,
  type AssessmentId,
  type LearningArea,
  type ReviewEvent,
  type Workspace,
} from "@recall/domain";
import { syncWorkspaceMedia, type WorkspaceMediaGateway } from "../media/workspace-media-sync";
import { toKnowledgeArea } from "../../interchange/knowledge-area-interchange";
import { prepareDeletedReviewProvisions } from "../../review/deleted-review-sync";
import { reconcileCanonicalReview } from "../../review/review-canonical-reconciliation";
import type {
  WorkspaceSyncFailure,
  WorkspaceSyncResponse,
  WorkspaceSyncInput,
  WorkspaceSyncRequest,
} from "./workspace-sync";
import {
  type Snapshot,
  failure,
  successful,
  snapshotFrom,
  conflictResult,
  stableContent,
} from "./workspace-sync-snapshots";
type PushInput = {
  readonly input: WorkspaceSyncInput;
  readonly request: (
    request: WorkspaceSyncRequest,
  ) => Effect.Effect<WorkspaceSyncResponse, WorkspaceSyncFailure>;
  readonly prepared: Workspace;
  readonly before: Snapshot;
  readonly mediaGateway: WorkspaceMediaGateway;
  readonly reviewBatch: readonly ReviewEvent[];
  readonly pendingEvents: readonly ReviewEvent[];
  readonly pending: ReadonlySet<ReviewEvent["id"]>;
  readonly sentOperations: readonly SyncReviewOperation[];
  readonly deletionCards: ReadonlyMap<
    AssessmentId,
    { readonly areaId: AreaId; readonly cardId: AssessmentId }
  >;
  readonly safeCardTombstones: readonly {
    readonly areaId: AreaId;
    readonly cardId: AssessmentId;
  }[];
  readonly protectedCardIds: ReadonlySet<AssessmentId>;
  readonly ownerId: string;
  readonly resumingPull: boolean;
  readonly uploadDeferred: boolean;
};
export function pushWorkspaceChanges(options: PushInput) {
  const {
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
    uploadDeferred: initialUploadDeferred,
  } = options;
  return Effect.gen(function* () {
    let uploadDeferred = initialUploadDeferred;
    let acceptedIds: SyncPushResponse["acceptedIds"] = [];
    let conflicts: SyncPushResponse["conflicts"] = [];
    const syncedAreaTombstoneIds: AreaId[] = [];
    const confirmedCardIds: AssessmentId[] = [];
    const canonicalAcceptedEvents: ReviewEvent[] = [];
    if (!resumingPull) {
      if ((prepared.syncContentConflictAreaIds ?? []).length > 0) {
        return yield* conflictResult(input, prepared, before);
      }
      if (
        (prepared.deletedAreas ?? []).some(
          (item) =>
            !item.synced &&
            item.baseContentHash &&
            before.areas.some(
              (area) =>
                area.document.id === item.areaId && area.contentHash !== item.baseContentHash,
            ),
        )
      )
        return yield* conflictResult(input, prepared, before);
      const identityResponse =
        reviewBatch.length === 0
          ? null
          : yield* request({
              path: "/api/v1/workspace/review-identities",
              method: "POST",
              body: {
                schemaVersion: 1,
                cardIds: [...new Set(reviewBatch.map((event) => event.cardId))],
              },
            });
      const identities = identityResponse
        ? Schema.decodeUnknownEither(WorkspaceReviewIdentitiesResponseSchema)(identityResponse.body)
        : null;
      if (
        identityResponse &&
        (!successful(identityResponse) || !identities || Either.isLeft(identities))
      )
        return yield* Effect.fail(failure("reviews"));
      const knownCards =
        identities && Either.isRight(identities) ? identities.right.reviewCards : [];
      if (identities && Either.isRight(identities) && identities.right.ownerId !== ownerId)
        return yield* Effect.fail(failure("account-changed"));
      const requestedCards = new Set(reviewBatch.map((event) => event.cardId));
      if (
        knownCards.some((card) => !requestedCards.has(createAssessmentId(card.id))) ||
        new Set(knownCards.map((card) => card.id)).size !== knownCards.length
      )
        return yield* Effect.fail(failure("reviews"));
      const provisions = yield* prepareDeletedReviewProvisions(
        prepared,
        reviewBatch,
        knownCards,
        before,
        new Set(safeCardTombstones.map((item) => item.cardId)),
      );
      const stagedIds = new Set(provisions.map((area) => area.document.id));
      if (provisions.length > 0) uploadDeferred = true;
      const localById = new Map<string, LearningArea>(
        prepared.areas.map((area) => [area.id, area]),
      );
      const remoteIds = new Set(before.areas.map((area) => area.document.id));
      const deletedAreas = new Set([
        ...(prepared.deletedAreas ?? []).map((item) => item.areaId),
        ...before.deletedAreaIds,
      ]);
      const existing = yield* Effect.forEach(
        before.areas.filter(
          (area) => !deletedAreas.has(area.document.id) && !stagedIds.has(area.document.id),
        ),
        (remote) => {
          const local = localById.get(remote.document.id);
          const baseContentHash = prepared.syncContentHashes?.[remote.document.id];
          if (!local || !baseContentHash)
            return Effect.succeed({ ...remote, baseContentHash: remote.contentHash });
          return toKnowledgeArea(local, true, true).pipe(
            Effect.mapError(() => failure("content")),
            Effect.map((document) => ({ document, color: local.color, baseContentHash })),
          );
        },
      );
      const added = yield* Effect.forEach(
        prepared.areas.filter(
          (area) =>
            !remoteIds.has(area.id) && !deletedAreas.has(area.id) && !stagedIds.has(area.id),
        ),
        (area) =>
          toKnowledgeArea(area, true, true).pipe(
            Effect.mapError(() => failure("content")),
            Effect.map((document) => ({
              document,
              color: area.color,
              baseContentHash: prepared.syncContentHashes?.[area.id] ?? null,
            })),
          ),
      );
      const contentAreas = [...existing, ...added, ...provisions];
      const expectedDeletionDocuments = new Map(
        before.areas.map((area) => [area.document.id, area.document]),
      );
      const initiallyDeletedCards = new Set(safeCardTombstones.map((item) => item.cardId));
      for (const area of contentAreas)
        expectedDeletionDocuments.set(area.document.id, {
          ...area.document,
          cards: area.document.cards.filter((card) => !initiallyDeletedCards.has(card.id)),
        });
      const hasDeletionConflict = (snapshot: Snapshot) =>
        (prepared.deletedAreas ?? []).some((item) => {
          const remote = snapshot.areas.find((area) => area.document.id === item.areaId);
          const expected = expectedDeletionDocuments.get(item.areaId);
          return (
            !item.synced &&
            remote !== undefined &&
            (expected === undefined || stableContent(remote.document) !== stableContent(expected))
          );
        });
      yield* syncWorkspaceMedia(
        input.mediaStore,
        mediaGateway,
        contentAreas.flatMap((area) => area.document.cards.flatMap((card) => card.media ?? [])),
      ).pipe(
        Effect.mapError((error) =>
          failure(error.reason === "account-changed" ? "account-changed" : "media"),
        ),
      );
      const contentResponse = yield* request({
        path: "/api/v1/workspace",
        method: "POST",
        body: { schemaVersion: 1, areas: contentAreas, tombstones: safeCardTombstones },
      });
      if (contentResponse.status === 409) return yield* conflictResult(input, prepared, before);
      if (
        !successful(contentResponse) ||
        Either.isLeft(
          Schema.decodeUnknownEither(WorkspaceContentPushResponseSchema)(contentResponse.body),
        )
      )
        return yield* Effect.fail(failure("content"));

      const pushResponse = yield* request({
        path: "/api/v1/sync",
        method: "POST",
        body: {
          schemaVersion: 1,
          deviceId: prepared.syncDeviceId,
          operations: sentOperations,
        },
      });
      const pushed = Schema.decodeUnknownEither(SyncPushResponseSchema)(pushResponse.body);
      if ((!successful(pushResponse) && pushResponse.status !== 409) || Either.isLeft(pushed))
        return yield* Effect.fail(failure("reviews"));
      if (
        pushed.right.acceptedIds.some(
          (id) => !sentOperations.some((operation) => operation.id === id),
        ) ||
        pushed.right.conflicts.some(
          (conflict) => !sentOperations.some((operation) => operation.id === conflict.id),
        ) ||
        new Set(pushed.right.acceptedIds).size !== pushed.right.acceptedIds.length ||
        new Set(pushed.right.conflicts.map((conflict) => conflict.id)).size !==
          pushed.right.conflicts.length ||
        pushed.right.conflicts.some((conflict) => pushed.right.acceptedIds.includes(conflict.id))
      )
        return yield* Effect.fail(failure("reviews"));
      const receipt = pushed.right.acceptedReviewEvents;
      if (receipt !== undefined) {
        const receiptIds = new Set(receipt.map((event) => event.id));
        if (
          receipt.length !== pushed.right.acceptedIds.length ||
          receiptIds.size !== receipt.length ||
          pushed.right.acceptedIds.some((id) => !receiptIds.has(id))
        )
          return yield* Effect.fail(failure("reviews"));
        for (const event of receipt) {
          const requested = reviewBatch.find((item) => item.id === event.id);
          if (!requested) return yield* Effect.fail(failure("reviews"));
          const canonical = yield* reconcileCanonicalReview(requested, event).pipe(
            Effect.mapError(() => failure("reviews")),
          );
          canonicalAcceptedEvents.push(canonical);
        }
      }
      confirmedCardIds.push(...safeCardTombstones.map((item) => item.cardId));
      acceptedIds = pushed.right.acceptedIds;
      conflicts = pushed.right.conflicts;
      const accepted = new Set(acceptedIds);
      const remainingCards = new Set(
        pendingEvents.filter((event) => !accepted.has(event.id)).map((event) => event.cardId),
      );
      const newlySafe = [...deletionCards.values()].filter(
        (item) => protectedCardIds.has(item.cardId) && !remainingCards.has(item.cardId),
      );
      let currentSnapshot = yield* request({ path: "/api/v1/workspace", method: "GET" }).pipe(
        Effect.flatMap(snapshotFrom),
      );
      if (currentSnapshot.ownerId !== ownerId)
        return yield* Effect.fail(failure("account-changed"));
      if (hasDeletionConflict(currentSnapshot))
        return yield* conflictResult(input, prepared, currentSnapshot);
      if (newlySafe.length > 0) {
        const areaIds = new Set(newlySafe.map((item) => item.areaId));
        const response = yield* request({
          path: "/api/v1/workspace",
          method: "POST",
          body: {
            schemaVersion: 1,
            areas: currentSnapshot.areas
              .filter((area) => areaIds.has(createAreaId(area.document.id)))
              .map((area) => ({ ...area, baseContentHash: area.contentHash })),
            tombstones: newlySafe,
          },
        });
        if (response.status === 409) return yield* conflictResult(input, prepared, currentSnapshot);
        if (
          !successful(response) ||
          Either.isLeft(
            Schema.decodeUnknownEither(WorkspaceContentPushResponseSchema)(response.body),
          )
        )
          return yield* Effect.fail(failure("content"));
        const tombstoned = new Set(newlySafe.map((item) => item.cardId));
        for (const area of currentSnapshot.areas)
          if (areaIds.has(createAreaId(area.document.id)))
            expectedDeletionDocuments.set(area.document.id, {
              ...area.document,
              cards: area.document.cards.filter((card) => !tombstoned.has(card.id)),
            });
        confirmedCardIds.push(...newlySafe.map((item) => item.cardId));
        currentSnapshot = yield* request({ path: "/api/v1/workspace", method: "GET" }).pipe(
          Effect.flatMap(snapshotFrom),
        );
        if (currentSnapshot.ownerId !== ownerId)
          return yield* Effect.fail(failure("account-changed"));
      }
      if (hasDeletionConflict(currentSnapshot))
        return yield* conflictResult(input, prepared, currentSnapshot);
      const pendingTombstones = (prepared.deletedAreas ?? []).flatMap((item) => {
        const baseContentHash = currentSnapshot.areas.find(
          (area) => area.document.id === item.areaId,
        )?.contentHash;
        if (
          currentSnapshot.deletedAreaIds.includes(item.areaId) ||
          (!baseContentHash &&
            !pendingEvents.some((event) => event.areaId === item.areaId && !accepted.has(event.id)))
        )
          syncedAreaTombstoneIds.push(item.areaId);
        return !item.synced && baseContentHash ? [{ areaId: item.areaId, baseContentHash }] : [];
      });
      const pendingReviewsRemain = [...pending].some((id) => !accepted.has(id));
      if (pendingTombstones.length > 0 && pendingReviewsRemain) uploadDeferred = true;
      if (
        pendingTombstones.length > 0 &&
        pushed.right.conflicts.length === 0 &&
        !pendingReviewsRemain
      ) {
        const response = yield* request({
          path: "/api/v1/workspace/area-tombstones",
          method: "POST",
          body: { areaTombstones: pendingTombstones },
        });
        if (response.status === 409) return yield* conflictResult(input, prepared, before);
        if (!successful(response)) return yield* Effect.fail(failure("content"));
        syncedAreaTombstoneIds.push(...pendingTombstones.map((item) => item.areaId));
      }
    }
    return {
      _tag: "Pushed",
      acceptedIds,
      conflicts,
      syncedAreaTombstoneIds,
      confirmedCardIds,
      canonicalAcceptedEvents,
      uploadDeferred,
    } as const;
  });
}
