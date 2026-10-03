import { Effect, Either, Schema } from "effect";
import {
  DeletedAreaIdsSchema,
  SyncPullResponseSchema,
  SyncReviewOperationSchema,
  SyncPushResponseSchema,
  type SyncReviewOperation,
} from "@recall/contracts";
import {
  KnowledgeAreaSchema,
  ReviewEventSchema,
  type KnowledgeArea,
  type LearningArea,
  type ReviewEvent,
  type Workspace,
} from "@recall/domain";
import { newSchedule, rebuildSchedule } from "@recall/scheduler";
import { prepareWorkspaceForSync, repairReviewSyncConflicts } from "@recall/sync-core";
import { toKnowledgeArea } from "@recall/application";

const snapshotSchema = Schema.Struct({
  areas: Schema.Array(
    Schema.Struct({
      document: KnowledgeAreaSchema,
      color: Schema.String.pipe(Schema.pattern(/^#[0-9a-f]{6}$/i)),
      contentHash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/i)),
    }),
  ),
  deletedAreaIds: DeletedAreaIdsSchema,
});

type RemoteSnapshot = typeof snapshotSchema.Type;
export type NativeSyncResult =
  | { readonly _tag: "Synced"; readonly workspace: Workspace }
  | { readonly _tag: "ContentConflict"; readonly workspace: Workspace }
  | { readonly _tag: "Failed" };

function makeAreaDocument(area: LearningArea): KnowledgeArea | null {
  const document = Effect.runSync(Effect.either(toKnowledgeArea(area, true)));
  return Either.isRight(document) ? document.right : null;
}

function areaFromDocument(
  document: KnowledgeArea,
  color: string,
  previous?: LearningArea,
): LearningArea | null {
  const titleById = new Map(
    document.objectives.map((objective) => [objective.id, objective.title]),
  );
  const localCards = new Map(previous?.cards.map((card) => [card.id, card]));
  const cards = document.cards.flatMap((card) => {
    if (card.kind !== "basic") return [];
    const prior = localCards.get(card.id);
    return [
      {
        id: card.id,
        front: card.front,
        back: card.back,
        objective:
          card.objectiveIds.map((id) => titleById.get(id) ?? "Learning objective").join(" · ") ||
          "Learning objective",
        objectiveIds: card.objectiveIds,
        tags: card.tags,
        origin: card.origin,
        schedule: prior?.schedule ?? newSchedule(),
      },
    ];
  });
  return {
    id: document.id,
    ...(previous?.sourceId ? { sourceId: previous.sourceId } : {}),
    title: document.title,
    color,
    description: document.description,
    language: document.language,
    ai: document.ai,
    objectives: document.objectives,
    cards,
    tags: document.tags,
    licence: document.licence,
  };
}

function decodeSnapshot(value: unknown): RemoteSnapshot | null {
  const decoded = Schema.decodeUnknownEither(snapshotSchema)(value);
  return Either.isRight(decoded) ? decoded.right : null;
}

function workspaceFromSnapshot(workspace: Workspace, snapshot: RemoteSnapshot): Workspace {
  const localAreas = new Map(workspace.areas.map((area) => [area.id, area]));
  const events = workspace.reviewEvents ?? [];
  const deletedIds = new Set<string>(snapshot.deletedAreaIds);
  const remoteIds = new Set<string>(snapshot.areas.map((remote) => remote.document.id));
  const remoteAreas = snapshot.areas.flatMap((remote) => {
    const area = areaFromDocument(
      remote.document,
      remote.color,
      localAreas.get(remote.document.id),
    );
    if (!area) return [];
    return [
      {
        ...area,
        cards: area.cards.map((card) => {
          const cardEvents = events.filter((event) => event.cardId === card.id);
          return cardEvents.length ? { ...card, schedule: rebuildSchedule(cardEvents) } : card;
        }),
      },
    ];
  });
  const areas = [
    ...remoteAreas,
    ...workspace.areas.filter((area) => !remoteIds.has(area.id) && !deletedIds.has(area.id)),
  ];
  const contentHashes = Object.fromEntries(
    snapshot.areas.map((area) => [area.document.id, area.contentHash]),
  );
  const deletedAreas = new Map((workspace.deletedAreas ?? []).map((item) => [item.areaId, item]));
  for (const areaId of deletedIds) deletedAreas.set(areaId, { areaId, synced: true });
  return {
    ...workspace,
    areas,
    syncContentHashes: { ...(workspace.syncContentHashes ?? {}), ...contentHashes },
    deletedAreas: [...deletedAreas.values()].filter((item) => !remoteIds.has(item.areaId)),
  };
}

async function readJson(response: Response): Promise<unknown | null> {
  const result = await Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: () => ({ _tag: "SyncResponseReadError" }) as const,
      }),
    ),
  );
  return Either.isRight(result) ? result.right : null;
}

async function syncSnapshot(
  workspace: Workspace,
  accessToken: string,
  createId: () => string,
): Promise<NativeSyncResult> {
  const apiUrl = process.env.EXPO_PUBLIC_RECALL_API_URL?.trim().replace(/\/$/, "");
  if (!apiUrl || accessToken.length === 0) return { _tag: "Failed" };
  const prepared = prepareWorkspaceForSync(workspace, createId);
  const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
  const beforeResponse = await fetch(`${apiUrl}/api/v1/workspace`, { headers });
  const before = decodeSnapshot(await readJson(beforeResponse));
  if (!beforeResponse.ok || !before) return { _tag: "Failed" };

  const localById = new Map<string, LearningArea>(prepared.areas.map((area) => [area.id, area]));
  const remoteById = new Map<string, (typeof before.areas)[number]>(
    before.areas.map((area) => [area.document.id, area]),
  );
  const deletedAreas = new Set([
    ...(prepared.deletedAreas ?? []).map((item) => item.areaId),
    ...before.deletedAreaIds,
  ]);
  let invalidContentArea = false;
  const contentAreas = [
    ...before.areas
      .filter((remote) => !deletedAreas.has(remote.document.id))
      .map((remote) => {
        const local = localById.get(remote.document.id);
        const baseContentHash = prepared.syncContentHashes?.[remote.document.id];
        if (!local || !baseContentHash) return { ...remote, baseContentHash: remote.contentHash };
        const document = makeAreaDocument(local);
        if (!document) {
          invalidContentArea = true;
          return { ...remote, baseContentHash: remote.contentHash };
        }
        return { document, color: local.color, baseContentHash };
      }),
    ...prepared.areas
      .filter((area) => !remoteById.has(area.id) && !deletedAreas.has(area.id))
      .map((area) => {
        const document = makeAreaDocument(area);
        if (!document) {
          invalidContentArea = true;
          return null;
        }
        return {
          document,
          color: area.color,
          baseContentHash: prepared.syncContentHashes?.[area.id] ?? null,
        };
      })
      .filter((area) => area !== null),
  ];
  if (invalidContentArea) return { _tag: "Failed" };
  const contentResponse = await fetch(`${apiUrl}/api/v1/workspace`, {
    method: "POST",
    headers,
    body: JSON.stringify({ areas: contentAreas, tombstones: prepared.deletedCards ?? [] }),
  });
  if (contentResponse.status === 409)
    return { _tag: "ContentConflict", workspace: workspaceFromSnapshot(prepared, before) };
  if (!contentResponse.ok) return { _tag: "Failed" };

  const pending = new Set(prepared.pendingReviewEventIds ?? []);
  let invalidOperation = false;
  const operations: SyncReviewOperation[] = (prepared.reviewEvents ?? []).flatMap((event) => {
    if (!pending.has(event.id) || !event.deviceSequence || !event.deviceId) return [];
    const decoded = Schema.decodeUnknownEither(SyncReviewOperationSchema)({
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
    if (Either.isLeft(decoded)) {
      invalidOperation = true;
      return [];
    }
    return [decoded.right];
  });
  if (invalidOperation) return { _tag: "Failed" };
  const pushResponse = await fetch(`${apiUrl}/api/v1/sync`, {
    method: "POST",
    headers,
    body: JSON.stringify({ schemaVersion: 1, deviceId: prepared.syncDeviceId, operations }),
  });
  const pushedUnknown = await readJson(pushResponse);
  const pushed = Schema.decodeUnknownEither(SyncPushResponseSchema)(pushedUnknown);
  if ((!pushResponse.ok && pushResponse.status !== 409) || Either.isLeft(pushed))
    return { _tag: "Failed" };

  const pendingAreaTombstones = (prepared.deletedAreas ?? []).filter(
    (item) => !item.synced && item.baseContentHash,
  );
  const syncedAreaTombstoneIds: string[] = [];
  if (pendingAreaTombstones.length > 0 && pushed.right.conflicts.length === 0) {
    const tombstoneResponse = await fetch(`${apiUrl}/api/v1/workspace/area-tombstones`, {
      method: "POST",
      headers,
      body: JSON.stringify({ areaTombstones: pendingAreaTombstones }),
    });
    if (tombstoneResponse.status === 409)
      return { _tag: "ContentConflict", workspace: workspaceFromSnapshot(prepared, before) };
    if (!tombstoneResponse.ok) return { _tag: "Failed" };
    syncedAreaTombstoneIds.push(...pendingAreaTombstones.map(({ areaId }) => areaId));
  }

  let cursor = prepared.syncCursor ?? "0";
  const pulledEvents: ReviewEvent[] = [];
  const deletedCardIds: string[] = [];
  const deletedAreaIds: string[] = [...before.deletedAreaIds];
  let pullComplete = false;
  for (let page = 0; page < 100; page += 1) {
    const pullResponse = await fetch(`${apiUrl}/api/v1/sync?cursor=${encodeURIComponent(cursor)}`, {
      headers,
    });
    const pull = Schema.decodeUnknownEither(SyncPullResponseSchema)(await readJson(pullResponse));
    if (!pullResponse.ok || Either.isLeft(pull)) return { _tag: "Failed" };
    for (const change of pull.right.changes) {
      if (change.entityType === "card" && change.operation === "tombstone")
        deletedCardIds.push(change.entityId);
      if (change.entityType === "area" && change.operation === "tombstone")
        deletedAreaIds.push(change.entityId);
      if (change.entityType !== "review_event") continue;
      const event = Schema.decodeUnknownEither(ReviewEventSchema)(change.payload);
      if (Either.isLeft(event)) return { _tag: "Failed" };
      pulledEvents.push(event.right);
    }
    if (pull.right.cursor === cursor && pull.right.hasMore) return { _tag: "Failed" };
    cursor = pull.right.cursor;
    if (!pull.right.hasMore) {
      pullComplete = true;
      break;
    }
  }
  if (!pullComplete) return { _tag: "Failed" };

  const afterResponse = await fetch(`${apiUrl}/api/v1/workspace`, { headers });
  const after = decodeSnapshot(await readJson(afterResponse));
  if (!afterResponse.ok || !after) return { _tag: "Failed" };
  const localAreas = new Map(prepared.areas.map((area) => [area.id, area]));
  const areas = after.areas.flatMap((remote) => {
    const area = areaFromDocument(
      remote.document,
      remote.color,
      localAreas.get(remote.document.id),
    );
    return area ? [area] : [];
  });
  const uniqueEvents = new Map((prepared.reviewEvents ?? []).map((event) => [event.id, event]));
  for (const event of pulledEvents)
    if (!uniqueEvents.has(event.id)) uniqueEvents.set(event.id, event);
  const reviewEvents = [...uniqueEvents.values()];
  const deletedCardSet = new Set(deletedCardIds);
  const deletedAreaSet = new Set(deletedAreaIds);
  const accepted = new Set<string>(pushed.right.acceptedIds);
  const rebased = repairReviewSyncConflicts(prepared, pushed.right.conflicts, createId);
  const rebasedIds = new Map((rebased.reviewEvents ?? []).map((event) => [event.id, event]));
  const reconciledEvents = reviewEvents.map((event) => rebasedIds.get(event.id) ?? event);
  const contentHashes = Object.fromEntries(
    after.areas.map((area) => [area.document.id, area.contentHash]),
  );
  const deletedCards = new Map((prepared.deletedCards ?? []).map((item) => [item.cardId, item]));
  for (const cardId of deletedCardSet) {
    const areaId = prepared.areas.find((area) => area.cards.some((card) => card.id === cardId))?.id;
    if (areaId && !deletedCards.has(cardId)) deletedCards.set(cardId, { areaId, cardId });
  }
  const deletedAreaTombstones = new Map(
    (rebased.deletedAreas ?? []).map((item) => [item.areaId, item]),
  );
  for (const areaId of syncedAreaTombstoneIds) {
    const existing = deletedAreaTombstones.get(areaId);
    if (existing) deletedAreaTombstones.set(areaId, { ...existing, synced: true });
  }
  for (const areaId of deletedAreaSet) deletedAreaTombstones.set(areaId, { areaId, synced: true });
  return {
    _tag: "Synced",
    workspace: {
      ...rebased,
      areas: areas
        .filter((area) => !deletedAreaSet.has(area.id))
        .map((area) => ({
          ...area,
          cards: area.cards
            .filter((card) => !deletedCardSet.has(card.id))
            .map((card) => {
              const events = reconciledEvents.filter((event) => event.cardId === card.id);
              return events.length ? { ...card, schedule: rebuildSchedule(events) } : card;
            }),
        })),
      reviewEvents: reconciledEvents,
      reviews: Math.max(rebased.reviews, reconciledEvents.length),
      pendingReviewEventIds: (rebased.pendingReviewEventIds ?? []).filter(
        (id) => !accepted.has(id),
      ),
      reviewConflictIds: (rebased.reviewConflictIds ?? []).filter((id) => !accepted.has(id)),
      deletedCards: [...deletedCards.values()],
      deletedAreas: [...deletedAreaTombstones.values()],
      syncContentHashes: { ...(prepared.syncContentHashes ?? {}), ...contentHashes },
      syncCursor: cursor,
    },
  };
}

export function syncNativeWorkspace(
  workspace: Workspace,
  accessToken: string,
  createId: () => string,
): Effect.Effect<NativeSyncResult, { readonly _tag: "NativeWorkspaceSyncError" }> {
  return Effect.tryPromise({
    try: () => syncSnapshot(workspace, accessToken, createId),
    catch: () => ({ _tag: "NativeWorkspaceSyncError" }) as const,
  });
}
