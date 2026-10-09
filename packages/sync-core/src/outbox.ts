import {
  createAreaId,
  createAssessmentId,
  createDeviceId,
  createObjectiveId,
  createReviewEventId,
  type AreaId,
  type ReviewEvent,
  type ReviewEventId,
  type Workspace,
} from "@recall/domain";
import type { SyncPushResponse } from "@recall/contracts";
import { stableSyncId } from "./ids";

export function repairReviewSyncConflicts(
  workspace: Workspace,
  conflicts: SyncPushResponse["conflicts"],
  createId: () => string,
): Workspace {
  if (conflicts.length === 0) return workspace;
  const collisionIds = new Set<string>(
    conflicts
      .filter((conflict) => conflict.reason === "id-collision")
      .map((item): string => item.id),
  );
  const replacements = new Map(
    [...collisionIds].map((id) => [id, createReviewEventId(createId())]),
  );
  const pending = new Set(workspace.pendingReviewEventIds ?? []);
  const currentDeviceId = workspace.syncDeviceId ?? createDeviceId(createId());
  const sequenceConflict = conflicts.some(
    (conflict) => conflict.reason === "device-sequence-conflict",
  );
  const nextDeviceId = sequenceConflict ? createDeviceId(createId()) : currentDeviceId;
  const orderedPendingEvents = [...(workspace.reviewEvents ?? [])]
    .filter((event) => pending.has(event.id))
    .sort((left, right) => left.ratedAt.localeCompare(right.ratedAt));
  const sequenceById = new Map(orderedPendingEvents.map((event, index) => [event.id, index + 1]));
  const reviewEvents = (workspace.reviewEvents ?? []).map((event) => {
    const id = replacements.get(event.id) ?? event.id;
    const remappedParent =
      event.baseReviewEventId &&
      event.deviceId === currentDeviceId &&
      replacements.has(event.baseReviewEventId)
        ? (replacements.get(event.baseReviewEventId) ?? event.baseReviewEventId)
        : event.baseReviewEventId;
    const deviceSequence = sequenceById.get(event.id);
    if (sequenceConflict && deviceSequence !== undefined) {
      return {
        ...event,
        id,
        baseReviewEventId: remappedParent,
        deviceId: nextDeviceId,
        deviceSequence,
      };
    }
    return { ...event, id, baseReviewEventId: remappedParent };
  });
  return {
    ...workspace,
    syncDeviceId: nextDeviceId,
    reviewEvents,
    reviewConflictIds: [
      ...new Set([
        ...(workspace.reviewConflictIds ?? []),
        ...conflicts.map((conflict) => replacements.get(conflict.id) ?? conflict.id),
      ]),
    ],
    pendingReviewEventIds: (workspace.pendingReviewEventIds ?? []).map(
      (id) => replacements.get(id) ?? id,
    ),
  };
}

export function prepareWorkspaceForSync(workspace: Workspace, createId: () => string): Workspace {
  const allAreas = [
    ...(workspace.cardVersions ?? []).map((version) => ({
      ...version.area,
      cards: [version.card],
    })),
    ...workspace.areas,
    ...(workspace.retainedReviewAreas ?? []),
  ];
  const identityAreas = [...new Map(allAreas.map((area) => [area.id, area])).values()].map(
    (area) => ({
      ...area,
      cards: [
        ...new Map(
          allAreas
            .filter((item) => item.id === area.id)
            .flatMap((item) => item.cards.map((card) => [card.id, card] as const)),
        ).values(),
      ],
      ...(allAreas.some((item) => item.id === area.id && item.objectives !== undefined)
        ? {
            objectives: [
              ...new Map(
                allAreas
                  .filter((item) => item.id === area.id)
                  .flatMap((item) =>
                    (
                      item.objectives ??
                      [...new Set(item.cards.map((card) => card.objective))].map((title) => ({
                        id: createObjectiveId(
                          stableSyncId(`objective:${item.sourceId ?? item.id}:${title}`),
                        ),
                        title,
                        description: null,
                        prerequisiteIds: [],
                      }))
                    ).map((objective) => [objective.id, objective] as const),
                  ),
              ).values(),
            ],
          }
        : {}),
    }),
  );
  const scopedKey = (areaId: string, entityId: string) => `${areaId}\u0000${entityId}`;
  const isUuid = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const areaSeed = (area: Workspace["areas"][number]) => area.sourceId ?? area.id;
  const areaIds = new Map<string, AreaId>(
    identityAreas.map((area) => [
      area.id,
      isUuid(area.id) ? area.id : createAreaId(stableSyncId(`area:${areaSeed(area)}`)),
    ]),
  );
  const cardIds = new Map(
    identityAreas.flatMap((area) =>
      area.cards.map(
        (card) =>
          [
            scopedKey(area.id, card.id),
            isUuid(card.id)
              ? card.id
              : createAssessmentId(
                  stableSyncId(`card:${areaSeed(area)}:${card.sourceId ?? card.id}`),
                ),
          ] as const,
      ),
    ),
  );
  const objectivesByArea = new Map<string, NonNullable<Workspace["areas"][number]["objectives"]>>(
    identityAreas.map((area) => [
      area.id,
      area.objectives ??
        Array.from(new Set(area.cards.map((card) => card.objective))).map((title) => ({
          id: createObjectiveId(stableSyncId(`objective:${areaSeed(area)}:${title}`)),
          title,
          description: null,
          prerequisiteIds: [],
        })),
    ]),
  );
  const objectiveIds = new Map(
    identityAreas.flatMap((area) =>
      (objectivesByArea.get(area.id) ?? []).map(
        (objective) =>
          [
            scopedKey(area.id, objective.id),
            isUuid(objective.id)
              ? objective.id
              : createObjectiveId(stableSyncId(`objective:${areaSeed(area)}:${objective.id}`)),
          ] as const,
      ),
    ),
  );
  const normalizeArea = (area: Workspace["areas"][number]) => ({
    ...area,
    id: areaIds.get(area.id) ?? area.id,
    sourceId: area.sourceId ?? (isUuid(area.id) ? undefined : area.id),
    objectives: (
      area.objectives ??
      objectivesByArea
        .get(area.id)
        ?.filter((objective) => area.cards.some((card) => card.objective === objective.title))
    )?.map((objective) => ({
      ...objective,
      sourceId: objective.sourceId ?? (isUuid(objective.id) ? undefined : objective.id),
      id: objectiveIds.get(scopedKey(area.id, objective.id)) ?? objective.id,
      prerequisiteIds: objective.prerequisiteIds.map(
        (id) => objectiveIds.get(scopedKey(area.id, id)) ?? id,
      ),
    })),
    cards: area.cards.map((card) => ({
      ...card,
      id: cardIds.get(scopedKey(area.id, card.id)) ?? card.id,
      sourceId: card.sourceId ?? (isUuid(card.id) ? undefined : card.id),
      objectiveIds: (
        card.objectiveIds ??
        objectivesByArea
          .get(area.id)
          ?.filter((item) => item.title === card.objective)
          .map((item) => item.id)
      )?.map((id) => objectiveIds.get(scopedKey(area.id, id)) ?? id),
    })),
  });
  const areas = workspace.areas.map(normalizeArea);
  const retainedReviewAreas = workspace.retainedReviewAreas?.map(normalizeArea);
  const cardIdMap = new Map(
    identityAreas.flatMap((area) =>
      area.cards.map(
        (card) =>
          [
            scopedKey(area.id, card.id),
            cardIds.get(scopedKey(area.id, card.id)) ?? card.id,
          ] as const,
      ),
    ),
  );
  const deviceId =
    workspace.syncDeviceId && isUuid(workspace.syncDeviceId)
      ? workspace.syncDeviceId
      : createDeviceId(createId());
  const originalEvents = workspace.reviewEvents ?? [];
  const eventIds = new Map(
    originalEvents.map((event) => [
      event.id,
      isUuid(event.id) ? event.id : createReviewEventId(stableSyncId(`review:${event.id}`)),
    ]),
  );
  let sequence = 0;
  const lastEventByCard = new Map<string, ReviewEventId>();
  const reviewEvents = [...originalEvents]
    .sort((left, right) => left.ratedAt.localeCompare(right.ratedAt))
    .map((event) => {
      const cardId = cardIdMap.get(scopedKey(event.areaId, event.cardId)) ?? event.cardId;
      const eventId = eventIds.get(event.id) ?? event.id;
      sequence = Math.max(sequence, event.deviceId === deviceId ? (event.deviceSequence ?? 0) : 0);
      const normalized: ReviewEvent = {
        ...event,
        id: eventId,
        areaId: areaIds.get(event.areaId) ?? event.areaId,
        cardId,
        deviceId: event.deviceId && isUuid(event.deviceId) ? event.deviceId : deviceId,
        deviceSequence: event.deviceSequence ?? ++sequence,
        baseReviewEventId: event.baseReviewEventId
          ? (eventIds.get(event.baseReviewEventId) ?? createReviewEventId(event.baseReviewEventId))
          : (lastEventByCard.get(cardId) ?? null),
        reviewedAtDevice: event.reviewedAtDevice ?? event.ratedAt,
        effectiveReviewedAt: event.effectiveReviewedAt ?? event.ratedAt,
        elapsedMs: event.elapsedMs ?? null,
        schedulerParameterSetId: event.schedulerParameterSetId ?? null,
        previousStateHash: event.previousStateHash ?? null,
      };
      if (normalized.deviceId === deviceId)
        sequence = Math.max(sequence, normalized.deviceSequence ?? 0);
      lastEventByCard.set(cardId, eventId);
      return normalized;
    });
  return {
    ...workspace,
    areas,
    ...(retainedReviewAreas ? { retainedReviewAreas } : {}),
    ...(workspace.cardVersions
      ? {
          cardVersions: workspace.cardVersions.map((version) => {
            const normalized = normalizeArea({ ...version.area, cards: [version.card] });
            const card = normalized.cards[0];
            return card
              ? {
                  ...version,
                  areaId: normalized.id,
                  cardId: card.id,
                  area: { ...normalized, cards: [] },
                  card,
                }
              : version;
          }),
        }
      : {}),
    ...(workspace.deletedAreas
      ? {
          deletedAreas: workspace.deletedAreas.map((item) => ({
            ...item,
            areaId: areaIds.get(item.areaId) ?? item.areaId,
          })),
        }
      : {}),
    ...(workspace.deletedCards
      ? {
          deletedCards: workspace.deletedCards.map((item) => ({
            ...item,
            areaId: areaIds.get(item.areaId) ?? item.areaId,
            cardId: cardIds.get(scopedKey(item.areaId, item.cardId)) ?? item.cardId,
          })),
        }
      : {}),
    ...(workspace.syncContentHashes
      ? {
          syncContentHashes: Object.fromEntries(
            Object.entries(workspace.syncContentHashes).map(([id, hash]) => [
              areaIds.get(id) ?? id,
              hash,
            ]),
          ),
        }
      : {}),
    ...(workspace.syncContentConflictAreaIds
      ? {
          syncContentConflictAreaIds: workspace.syncContentConflictAreaIds.map(
            (id) => areaIds.get(id) ?? id,
          ),
        }
      : {}),
    ...(workspace.syncPendingContentAreaIds
      ? {
          syncPendingContentAreaIds: workspace.syncPendingContentAreaIds.map(
            (id) => areaIds.get(id) ?? id,
          ),
        }
      : {}),
    syncDeviceId: deviceId,
    reviewEvents,
    pendingReviewEventIds:
      workspace.pendingReviewEventIds?.map((id) => eventIds.get(id) ?? id) ??
      reviewEvents.map((event) => event.id),
    syncCursor: workspace.syncCursor ?? "0",
  };
}
