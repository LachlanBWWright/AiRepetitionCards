import { Effect, Either, Schema } from "effect";
import {
  SyncPullResponseSchema,
  SyncReviewOperationSchema,
  SyncPushResponseSchema,
  WorkspaceContentPushResponseSchema,
  WorkspaceSnapshotSchema,
  WorkspaceReviewIdentitiesResponseSchema,
  type SyncPushResponse,
  type SyncReviewOperation,
} from "@recall/contracts";
import {
  ReviewEventSchema,
  AccountIdSchema,
  createAreaId,
  createAssessmentId,
  type AreaId,
  type AssessmentId,
  type LearningArea,
  type ReviewEvent,
  type Workspace,
} from "@recall/domain";
import {
  isValidSyncPullPage,
  orderReviewEvents,
  prepareWorkspaceForSync,
  repairReviewSyncConflicts,
} from "@recall/sync-core";
import type { MediaStore } from "@recall/local-store";
import { syncWorkspaceMedia, type WorkspaceMediaGateway } from "./workspace-media-sync";
import { fromKnowledgeArea, toKnowledgeArea } from "./knowledge-area-interchange";
import { rebuildWorkspaceSchedules } from "./schedule-replay";
import { bindWorkspaceOwner } from "./workspace-account";
import {
  retainedReviewContent,
  retainReviewDeletionContent,
  validateRetainedReviewContent,
  releaseRetainedReviewContent,
} from "./review-deletion-retention";
import { prepareDeletedReviewProvisions } from "./deleted-review-sync";
import { reconcileCanonicalReview } from "./review-canonical-reconciliation";

export type WorkspaceSyncRequest = {
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
};
export type WorkspaceSyncResponse = { readonly status: number; readonly body: unknown };
export type WorkspaceSyncTransportFailure = { readonly _tag: "WorkspaceSyncTransportFailure" };
export type WorkspaceSyncTransport = (
  request: WorkspaceSyncRequest,
) => Effect.Effect<WorkspaceSyncResponse, WorkspaceSyncTransportFailure>;
export type WorkspaceSyncFailure = {
  readonly _tag: "WorkspaceSyncFailure";
  readonly reason:
    | "invalid-time"
    | "request"
    | "content"
    | "media"
    | "reviews"
    | "replay"
    | "account-mismatch"
    | "owner-adoption-required"
    | "ownership-checkpoint"
    | "account-changed"
    | "deleted-review-content-missing"
    | "deleted-review-provision-capacity";
};
export type WorkspaceSyncCheckpointFailure = { readonly _tag: "WorkspaceSyncCheckpointFailure" };
export type WorkspaceSyncChanges = {
  readonly baseline: Workspace;
  readonly acceptedIds: readonly string[];
  readonly cursor: string;
  readonly hasMore: boolean;
  readonly uploadDeferred: boolean;
  readonly pulledEvents: readonly ReviewEvent[];
  readonly pulledAreas: readonly LearningArea[];
  readonly deletedCardIds: readonly AssessmentId[];
  readonly syncedAreaTombstoneIds: readonly AreaId[];
  readonly pulledDeletedAreaIds: readonly AreaId[];
  readonly contentHashes: Readonly<Record<string, string>>;
  readonly conflicts: SyncPushResponse["conflicts"];
};
export type WorkspaceSyncResult =
  | ({
      readonly _tag: "Synced";
      readonly workspace: Workspace;
      readonly remainingPendingReviews: number;
    } & WorkspaceSyncChanges)
  | {
      readonly _tag: "ContentConflict";
      readonly ownerId: string;
      readonly workspace: Workspace;
      readonly areas: readonly LearningArea[];
      readonly hashes: Readonly<Record<string, string>>;
      readonly deletedAreaIds: readonly AreaId[];
    };
export type WorkspaceSyncInput = {
  readonly workspace: Workspace;
  readonly now: Date;
  readonly createId: () => string;
  readonly transport: WorkspaceSyncTransport;
  readonly mediaStore: MediaStore;
  readonly mediaGatewayForOwner: (ownerId: string) => WorkspaceMediaGateway;
  readonly checkpoint: (
    workspace: Workspace,
  ) => Effect.Effect<Workspace, WorkspaceSyncCheckpointFailure>;
  readonly expectedOwnerId?: string;
  readonly adoptLegacyOwner?: boolean;
};
const failure = (reason: WorkspaceSyncFailure["reason"]): WorkspaceSyncFailure => ({
  _tag: "WorkspaceSyncFailure",
  reason,
});
type Snapshot = typeof WorkspaceSnapshotSchema.Type;
const successful = (response: WorkspaceSyncResponse): boolean =>
  response.status >= 200 && response.status < 300;

function snapshotFrom(
  response: WorkspaceSyncResponse,
): Effect.Effect<Snapshot, WorkspaceSyncFailure> {
  const decoded = Schema.decodeUnknownEither(WorkspaceSnapshotSchema)(response.body);
  return successful(response) && Either.isRight(decoded)
    ? Effect.succeed(decoded.right)
    : Effect.fail(failure("content"));
}

function snapshotAreas(snapshot: Snapshot, input: WorkspaceSyncInput, workspace: Workspace) {
  return Effect.forEach(snapshot.areas, (remote) =>
    fromKnowledgeArea(remote.document, remote.color, true, input.createId, input.now, true).pipe(
      Effect.mapError(() => failure("content")),
      Effect.map((area) => {
        const previous = workspace.areas.find((item) => item.id === area.id);
        const localCards = new Map(previous?.cards.map((card) => [card.id, card]));
        return {
          ...area,
          ...(previous?.sourceId ? { sourceId: previous.sourceId } : {}),
          cards: area.cards.map((card) => {
            const prior = localCards.get(card.id);
            return prior ? { ...card, sourceId: prior.sourceId, schedule: prior.schedule } : card;
          }),
        };
      }),
    ),
  );
}
function hashesFrom(snapshot: Snapshot): Readonly<Record<string, string>> {
  return Object.fromEntries(snapshot.areas.map((area) => [area.document.id, area.contentHash]));
}
export type WorkspaceContentConflict = {
  readonly ownerId: string;
  readonly areas: readonly LearningArea[];
  readonly hashes: Readonly<Record<string, string>>;
  readonly deletedAreaIds: readonly AreaId[];
};

/** Load an approved server preview while retaining local history and unsent local areas. */
export function applyWorkspaceContentConflict(
  workspace: Workspace,
  preview: WorkspaceContentConflict,
): Effect.Effect<Workspace, WorkspaceSyncFailure> {
  return Effect.gen(function* () {
    if (workspace.syncOwnerId !== preview.ownerId)
      return yield* Effect.fail(failure("account-mismatch"));
    const remoteIds = new Set(preview.areas.map((area) => area.id));
    const deletedIds = new Set([
      ...preview.deletedAreaIds,
      ...(workspace.deletedAreas ?? []).map((item) => item.areaId),
    ]);
    const deletedAreas = new Map((workspace.deletedAreas ?? []).map((item) => [item.areaId, item]));
    for (const areaId of preview.deletedAreaIds)
      deletedAreas.set(areaId, { ...deletedAreas.get(areaId), areaId, synced: true });
    for (const [areaId, item] of deletedAreas) {
      const hash = preview.hashes[areaId];
      if (!item.synced && hash) deletedAreas.set(areaId, { ...item, baseContentHash: hash });
    }
    const localAreas = new Map(workspace.areas.map((area) => [area.id, area]));
    const areas = preview.areas
      .filter((area) => !deletedIds.has(area.id))
      .map((area) => {
        const previous = localAreas.get(area.id);
        const localCards = new Map(previous?.cards.map((card) => [card.id, card]));
        return {
          ...area,
          ...(previous?.sourceId ? { sourceId: previous.sourceId } : {}),
          cards: area.cards
            .filter(
              (card) => !(workspace.deletedCards ?? []).some((item) => item.cardId === card.id),
            )
            .map((card) => {
              const prior = localCards.get(card.id);
              return prior ? { ...card, sourceId: prior.sourceId, schedule: prior.schedule } : card;
            }),
        };
      });
    let candidate: Workspace = {
      ...workspace,
      areas: [
        ...areas,
        ...workspace.areas.filter((area) => !remoteIds.has(area.id) && !deletedIds.has(area.id)),
      ],
      syncContentHashes: { ...(workspace.syncContentHashes ?? {}), ...preview.hashes },
      deletedAreas: [...deletedAreas.values()],
      syncContentConflictAreaIds: [],
      syncPendingContentAreaIds: [],
    };
    const pending = new Set(
      workspace.pendingReviewEventIds ?? workspace.reviewEvents?.map((event) => event.id) ?? [],
    );
    const cardTombstones = new Map(
      (workspace.deletedCards ?? []).map((item) => [`${item.areaId}:${item.cardId}`, item]),
    );
    const approvedCards = new Set(
      candidate.areas.flatMap((area) => area.cards.map((card) => card.id)),
    );
    for (const previous of workspace.areas) {
      if (!remoteIds.has(previous.id) && !preview.deletedAreaIds.includes(previous.id)) continue;
      const approved = candidate.areas.find((area) => area.id === previous.id);
      const retainedCardIds = previous.cards
        .filter(
          (card) =>
            !approved?.cards.some((item) => item.id === card.id) &&
            workspace.reviewEvents?.some(
              (event) =>
                event.areaId === previous.id && event.cardId === card.id && pending.has(event.id),
            ),
        )
        .map((card) => card.id);
      // A surviving identity in another approved area cannot also become a deletion intent.
      if (retainedCardIds.some((id) => approvedCards.has(id)))
        return yield* Effect.fail(failure("content"));
      for (const cardId of retainedCardIds)
        if (!deletedAreas.has(previous.id))
          cardTombstones.set(`${previous.id}:${cardId}`, { areaId: previous.id, cardId });
      candidate = yield* retainReviewDeletionContent(
        { ...candidate, deletedCards: [...cardTombstones.values()] },
        previous,
        retainedCardIds,
      ).pipe(Effect.mapError(() => failure("deleted-review-content-missing")));
    }
    return yield* rebuildWorkspaceSchedules(candidate).pipe(
      Effect.mapError(() => failure("replay")),
    );
  });
}
function conflictResult(input: WorkspaceSyncInput, workspace: Workspace, snapshot: Snapshot) {
  return Effect.gen(function* () {
    const areas = yield* snapshotAreas(snapshot, input, workspace);
    const preview = {
      ownerId: snapshot.ownerId,
      areas,
      hashes: hashesFrom(snapshot),
      deletedAreaIds: snapshot.deletedAreaIds,
    };
    const rebuilt = yield* applyWorkspaceContentConflict(workspace, preview);
    return { _tag: "ContentConflict", workspace: rebuilt, ...preview } as const;
  });
}

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
      after.areas.flatMap((area) => area.document.cards.flatMap((card) => card.media ?? [])),
    ).pipe(
      Effect.mapError((error) =>
        failure(error.reason === "account-changed" ? "account-changed" : "media"),
      ),
    );
    for (const areaId of after.deletedAreaIds)
      if (!pulledDeletedAreaIds.includes(areaId)) pulledDeletedAreaIds.push(areaId);
    const pulledAreas = yield* snapshotAreas(after, input, prepared);
    const changes: WorkspaceSyncChanges = {
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

function stableContent(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableContent).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableContent(item)}`)
      .join(",")}}`;
  return value === undefined ? "null" : JSON.stringify(value);
}
function areaContent(area: LearningArea): Effect.Effect<string, WorkspaceSyncFailure> {
  return toKnowledgeArea(area, true, true).pipe(
    Effect.map((document) => stableContent({ color: area.color, document })),
    Effect.mapError(() => failure("content")),
  );
}

/** Preserve in-flight content changes and require an explicit choice for overlapping remote edits. */
function reconcileContent(workspace: Workspace, changes: WorkspaceSyncChanges) {
  return Effect.gen(function* () {
    const baseline = new Map(changes.baseline.areas.map((area) => [area.id, area]));
    const latest = new Map(workspace.areas.map((area) => [area.id, area]));
    const remote = new Map(changes.pulledAreas.map((area) => [area.id, area]));
    const selected = new Map<AreaId, LearningArea>();
    const preserved = new Set<AreaId>();
    const conflicts = new Set(workspace.syncContentConflictAreaIds ?? []);
    const pendingContent = new Set(
      changes.hasMore || changes.uploadDeferred ? (workspace.syncPendingContentAreaIds ?? []) : [],
    );
    const localAreaDeletions: NonNullable<Workspace["deletedAreas"]>[number][] = [];
    for (const [id, local] of latest) {
      const start = baseline.get(id);
      const localContent = yield* areaContent(local);
      const startContent = start ? yield* areaContent(start) : null;
      const changed = !start || localContent !== startContent;
      if (changed) pendingContent.add(id);
      const pulled = remote.get(id);
      if (changed || changes.hasMore || changes.uploadDeferred) {
        selected.set(id, local);
        preserved.add(id);
        if (changed && !changes.hasMore && !changes.uploadDeferred) {
          const remoteContent = pulled ? yield* areaContent(pulled) : null;
          if (remoteContent !== startContent && remoteContent !== localContent) conflicts.add(id);
        }
      } else if (pulled) selected.set(id, pulled);
    }
    for (const [id, pulled] of remote) {
      if (latest.has(id)) continue;
      const start = baseline.get(id);
      if ((workspace.deletedAreas ?? []).some((item) => item.areaId === id)) continue;
      if (!start) {
        if (!changes.hasMore && !changes.uploadDeferred) selected.set(id, pulled);
        continue;
      }
      // A local removal made while this request was running must not resurrect.
      pendingContent.add(id);
      const baseContentHash = changes.contentHashes[id] ?? workspace.syncContentHashes?.[id];
      localAreaDeletions.push({ areaId: id, ...(baseContentHash ? { baseContentHash } : {}) });
      if (
        !changes.hasMore &&
        !changes.uploadDeferred &&
        (yield* areaContent(start)) !== (yield* areaContent(pulled))
      )
        conflicts.add(id);
    }
    return {
      areas: [...selected.values()],
      preserved,
      conflicts,
      pendingContent,
      localAreaDeletions,
    };
  });
}

/** Reconcile against the latest local copy before replaying append-only review history. */
export function applyWorkspaceSyncChanges(
  workspace: Workspace,
  changes: WorkspaceSyncChanges,
  createId: () => string,
): Effect.Effect<Workspace, WorkspaceSyncFailure> {
  return Effect.gen(function* () {
    if (!changes.baseline.syncOwnerId || workspace.syncOwnerId !== changes.baseline.syncOwnerId)
      return yield* Effect.fail(failure("account-mismatch"));
    const normalized = prepareWorkspaceForSync(
      {
        ...workspace,
        ...(!workspace.syncDeviceId && changes.baseline.syncDeviceId
          ? { syncDeviceId: changes.baseline.syncDeviceId }
          : {}),
      },
      createId,
    );
    const rebased = repairReviewSyncConflicts(normalized, changes.conflicts, createId);
    const content = yield* reconcileContent(rebased, changes);
    const events = new Map((rebased.reviewEvents ?? []).map((event) => [event.id, event]));
    for (const event of changes.pulledEvents) {
      const existing = events.get(event.id);
      events.set(
        event.id,
        existing
          ? yield* reconcileCanonicalReview(existing, event).pipe(
              Effect.mapError(() => failure("reviews")),
            )
          : event,
      );
    }
    const deletedCards = new Map((rebased.deletedCards ?? []).map((item) => [item.cardId, item]));
    for (const cardId of changes.deletedCardIds) {
      const areaId = [...changes.baseline.areas, ...retainedReviewContent(changes.baseline)].find(
        (area) => area.cards.some((card) => card.id === cardId),
      )?.id;
      if (areaId && !content.conflicts.has(areaId) && !deletedCards.has(cardId))
        deletedCards.set(cardId, { areaId, cardId });
    }
    const deletedAreas = new Map((rebased.deletedAreas ?? []).map((item) => [item.areaId, item]));
    for (const item of content.localAreaDeletions)
      if (!deletedAreas.has(item.areaId)) deletedAreas.set(item.areaId, item);
    for (const areaId of changes.syncedAreaTombstoneIds) {
      const existing = deletedAreas.get(areaId);
      const original = changes.baseline.deletedAreas?.find((item) => item.areaId === areaId);
      if (existing && existing.baseContentHash === original?.baseContentHash)
        deletedAreas.set(areaId, { ...existing, synced: true });
    }
    for (const [areaId, existing] of deletedAreas) {
      const original = changes.baseline.deletedAreas?.find((item) => item.areaId === areaId);
      const acknowledgedHash = changes.contentHashes[areaId];
      if (
        !existing.synced &&
        acknowledgedHash &&
        original &&
        existing.baseContentHash === original.baseContentHash &&
        !content.conflicts.has(areaId)
      )
        deletedAreas.set(areaId, { ...existing, baseContentHash: acknowledgedHash });
    }
    for (const areaId of changes.pulledDeletedAreaIds) {
      if (content.conflicts.has(areaId) && content.preserved.has(areaId)) continue;
      const existing = deletedAreas.get(areaId);
      deletedAreas.set(areaId, {
        ...(existing ?? { areaId }),
        ...(rebased.syncContentHashes?.[areaId]
          ? { baseContentHash: rebased.syncContentHashes[areaId] }
          : {}),
        synced: true,
      });
    }
    const localAreas = new Map(rebased.areas.map((area) => [area.id, area]));
    const accepted = new Set(changes.acceptedIds);
    const reviewEvents = [...events.values()];
    const reconciled = yield* rebuildWorkspaceSchedules({
      ...rebased,
      areas: content.areas
        .filter((area) => !deletedAreas.has(area.id))
        .map((area) => {
          const previous = localAreas.get(area.id);
          const cards = new Map(previous?.cards.map((card) => [card.id, card]));
          return {
            ...area,
            ...(previous?.sourceId ? { sourceId: previous.sourceId } : {}),
            cards: area.cards
              .filter((card) => !deletedCards.has(card.id))
              .map((card) => {
                const local = cards.get(card.id);
                return local
                  ? { ...card, sourceId: local.sourceId, schedule: local.schedule }
                  : card;
              }),
          };
        }),
      reviewEvents,
      reviews: Math.max(rebased.reviews, reviewEvents.length),
      pendingReviewEventIds: (rebased.pendingReviewEventIds ?? []).filter(
        (id) => !accepted.has(id),
      ),
      reviewConflictIds: (rebased.reviewConflictIds ?? []).filter((id) => !accepted.has(id)),
      deletedCards: [...deletedCards.values()],
      deletedAreas: [...deletedAreas.values()],
      syncContentHashes: { ...(rebased.syncContentHashes ?? {}), ...changes.contentHashes },
      syncContentConflictAreaIds: [...content.conflicts],
      syncPendingContentAreaIds: [...content.pendingContent],
      syncCursor: changes.cursor,
      syncHasMore: changes.hasMore,
    }).pipe(Effect.mapError(() => failure("replay")));
    return releaseRetainedReviewContent(reconciled, {
      deletedCardIds: changes.deletedCardIds,
      deletedAreaIds: [...changes.syncedAreaTombstoneIds, ...changes.pulledDeletedAreaIds],
    });
  });
}
