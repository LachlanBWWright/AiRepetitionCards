import { workspaceContentFingerprints } from "./content-baseline";
import { detachDeletedNoteOwner } from "../../notes/ownership";
import { Effect } from "effect";
import { applyStudyDocument, mergeStudyDocuments, workspaceStudyDocument } from "./study-sync";
import { toKnowledgeArea } from "../../interchange/knowledge-area-interchange";
import { prepareWorkspaceForSync, repairReviewSyncConflicts } from "@recall/sync-core";
import { reviewPlacement, type AreaId, type LearningArea, type Workspace } from "@recall/domain";
import { rebuildWorkspaceSchedules } from "../../review/schedule-replay";
import {
  retainedReviewContent,
  releaseRetainedReviewContent,
} from "../../review/review-deletion-retention";
import { reconcileCanonicalReview } from "../../review/review-canonical-reconciliation";
import type { WorkspaceSyncChanges, WorkspaceSyncFailure } from "./workspace-sync";
const failure = (reason: WorkspaceSyncFailure["reason"]): WorkspaceSyncFailure => ({
  _tag: "WorkspaceSyncFailure",
  reason,
});
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
    const repaired = repairReviewSyncConflicts(normalized, changes.conflicts, createId);
    const localStudy = workspaceStudyDocument(repaired);
    const mergedStudy = changes.studyDocument
      ? yield* Effect.either(
          mergeStudyDocuments(
            workspaceStudyDocument(changes.baseline),
            localStudy,
            changes.studyDocument,
          ),
        )
      : undefined;
    const document =
      mergedStudy?._tag === "Right"
        ? mergedStudy.right
        : changes.studyDocument
          ? yield* mergeStudyDocuments(
              { ...localStudy, settings: changes.studyDocument.settings },
              { ...localStudy, settings: changes.studyDocument.settings },
              changes.studyDocument,
            )
          : undefined;
    const rebased = document
      ? {
          ...applyStudyDocument(repaired, document),
          syncStudyBaseline: changes.studyDocument,
          studySettingsConflict:
            mergedStudy?._tag === "Left"
              ? { local: localStudy.settings, remote: document.settings }
              : (changes.studyConflict ?? repaired.studySettingsConflict),
        }
      : repaired;
    const content = yield* reconcileContent(rebased, changes);
    const placement = reviewPlacement({ ...rebased, areas: content.areas });
    const events = new Map((rebased.reviewEvents ?? []).map((event) => [event.id, event]));
    for (const event of changes.pulledEvents) {
      const existing = events.get(event.id);
      events.set(
        event.id,
        existing
          ? yield* reconcileCanonicalReview(existing, event, placement.areaId(existing)).pipe(
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
              .map((card) => restoreCardSchedule(card, cards)),
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
    const detached = changes.pulledDeletedAreaIds.reduce(
      (current, areaId) => detachDeletedNoteOwner(current, areaId),
      reconciled,
    );
    const released = releaseRetainedReviewContent(detached, {
      deletedCardIds: changes.deletedCardIds,
      deletedAreaIds: [...changes.syncedAreaTombstoneIds, ...changes.pulledDeletedAreaIds],
    });
    if (changes.hasMore || changes.uploadDeferred) return released;
    const fingerprints = yield* workspaceContentFingerprints({
      areas: released.areas.filter(
        (area) => !content.pendingContent.has(area.id) && !content.conflicts.has(area.id),
      ),
    });
    return {
      ...released,
      syncContentFingerprints: { ...released.syncContentFingerprints, ...fingerprints },
    };
  });
}

function restoreCardSchedule(
  card: LearningArea["cards"][number],
  cards: ReadonlyMap<LearningArea["cards"][number]["id"], LearningArea["cards"][number]>,
): LearningArea["cards"][number] {
  const local = cards.get(card.id);
  return local ? { ...card, sourceId: local.sourceId, schedule: local.schedule } : card;
}
