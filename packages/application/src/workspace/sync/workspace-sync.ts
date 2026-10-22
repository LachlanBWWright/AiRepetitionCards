import { detachDeletedNoteOwner } from "../../notes/ownership";
import { Effect } from "effect";
import type { SyncPushResponse } from "@recall/contracts";
import type { AreaId, AssessmentId, LearningArea, ReviewEvent, Workspace } from "@recall/domain";
import type { MediaStore } from "@recall/local-store";
import type { WorkspaceMediaGateway } from "../media/workspace-media-sync";
import { rebuildWorkspaceSchedules } from "../../review/schedule-replay";
import { retainReviewDeletionContent } from "../../review/review-deletion-retention";

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
    | "study-conflict"
    | "study-settings"
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
  readonly studyDocument?: import("@recall/domain").StudySyncDocument;
  readonly studyConflict?: Workspace["studySettingsConflict"];
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
            !approvedCards.has(card.id) &&
            !approved?.cards.some((item) => item.id === card.id) &&
            workspace.reviewEvents?.some(
              (event) => event.cardId === card.id && pending.has(event.id),
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
    for (const areaId of preview.deletedAreaIds)
      candidate = detachDeletedNoteOwner(candidate, areaId);
    return yield* rebuildWorkspaceSchedules(candidate).pipe(
      Effect.mapError(() => failure("replay")),
    );
  });
}
export { syncWorkspace } from "./workspace-sync-workflow";
export { applyWorkspaceSyncChanges } from "./workspace-sync-reconciliation";
