import {
  AreaIdSchema,
  AssessmentIdSchema,
  WorkspaceSchema,
  type CardVersion,
  type LearningArea,
  type Assessment,
  type Workspace,
  createAreaId,
  createAssessmentId,
} from "@recall/domain";
import { stableSyncId } from "@recall/sync-core";
import { newSchedule } from "@recall/scheduler";
import { workspaceHasRemoteSyncMetadata } from "./workspace-account";
import { Effect, Schema } from "effect";

export const RestoreCardVersionSchema = Schema.Struct({
  areaId: AreaIdSchema,
  cardId: AssessmentIdSchema,
  versionId: Schema.String.pipe(Schema.minLength(1)),
});
export type CardHistoryFailure = {
  readonly _tag: "CardHistoryFailure";
  readonly message: string;
};
const failure = (message: string): CardHistoryFailure => ({ _tag: "CardHistoryFailure", message });

/** Read private snapshots newest first without modifying their append-only storage. */
export function cardVersionHistory(
  workspace: Workspace,
  areaId?: string,
  cardId?: string,
): readonly CardVersion[] {
  return [...(workspace.cardVersions ?? [])]
    .filter(
      (version) => (!areaId || version.areaId === areaId) && (!cardId || version.cardId === cardId),
    )
    .reverse();
}

/** Snapshot authored content before changing it. Scheduling reviews do not produce versions. */
export function captureCardVersion(
  workspace: Workspace,
  area: LearningArea,
  card: Assessment,
  reason: CardVersion["reason"],
  now: Date,
): Workspace {
  const versions = workspace.cardVersions ?? [];
  let sequence = versions.length + 1;
  while (versions.some((version) => version.id === `version:${card.id}:${String(sequence)}`))
    sequence += 1;
  const version: CardVersion = {
    id: `version:${card.id}:${String(sequence)}`,
    areaId: area.id,
    cardId: card.id,
    recordedAt: now.toISOString(),
    reason,
    card,
    area: { ...area, cards: [] },
  };
  return { ...workspace, cardVersions: [...versions, version] };
}

export function cardVersionRestoresAsCopy(
  workspace: Workspace,
  areaId: string,
  cardId: string,
): boolean {
  return (
    !workspace.areas.find((area) => area.id === areaId)?.cards.some((card) => card.id === cardId) &&
    Boolean(workspace.syncOwnerId || workspaceHasRemoteSyncMetadata(workspace))
  );
}

/** Restore content while keeping live scheduling and append-only reviews intact. */
export function restoreCardVersion(
  workspaceInput: unknown,
  commandInput: unknown,
  now: Date,
): Effect.Effect<Workspace, CardHistoryFailure> {
  return Effect.gen(function* () {
    const workspace = yield* Schema.decodeUnknown(WorkspaceSchema)(workspaceInput).pipe(
      Effect.mapError(() => failure("This workspace contains invalid data.")),
    );
    const command = yield* Schema.decodeUnknown(RestoreCardVersionSchema)(commandInput).pipe(
      Effect.mapError(() => failure("This version could not be identified.")),
    );
    if (!Number.isFinite(now.getTime()))
      return yield* Effect.fail(failure("The restoration time is invalid."));
    const version = workspace.cardVersions?.find(
      (item) =>
        item.id === command.versionId &&
        item.areaId === command.areaId &&
        item.cardId === command.cardId,
    );
    if (!version || version.card.id !== command.cardId || version.area.id !== command.areaId)
      return yield* Effect.fail(failure("This card version is no longer available."));
    const area = workspace.areas.find((item) => item.id === command.areaId);
    const current = area?.cards.find((item) => item.id === command.cardId);
    if (
      workspace.areas.some(
        (item) =>
          item.id !== command.areaId && item.cards.some((card) => card.id === command.cardId),
      )
    )
      return yield* Effect.fail(failure("This card identity belongs to another area."));
    // Remote deletion tombstones are permanent; restore a fresh copy in connected workspaces.
    const asCopy = cardVersionRestoresAsCopy(workspace, command.areaId, command.cardId);
    let copySequence = workspace.cardVersions?.length ?? 0;
    const usedCardIds = new Set([
      ...workspace.areas.flatMap((item) => item.cards.map((card) => card.id)),
      ...(workspace.deletedCards ?? []).map((item) => item.cardId),
      ...(workspace.reviewEvents ?? []).map((event) => event.cardId),
      ...(workspace.cardVersions ?? []).map((item) => item.cardId),
    ]);
    let restoredCardId = command.cardId;
    if (asCopy) {
      do {
        restoredCardId = createAssessmentId(
          stableSyncId(`restore:${version.id}:${String(++copySequence)}`),
        );
      } while (usedCardIds.has(restoredCardId));
    }
    const restoredAreaId =
      asCopy && !area
        ? createAreaId(stableSyncId(`restore-area:${version.areaId}`))
        : command.areaId;
    const recoveredArea =
      area ?? (asCopy ? workspace.areas.find((item) => item.id === restoredAreaId) : undefined);
    if (!current && (recoveredArea?.cards.length ?? 0) >= 500)
      return yield* Effect.fail(
        failure("This area already has 500 cards. Remove a card before restoring another."),
      );
    const targetArea = recoveredArea ?? { ...version.area, id: restoredAreaId, cards: [] };
    const knownObjectives = new Set((targetArea.objectives ?? []).map((item) => item.id));
    const neededObjectives = new Set(version.card.objectiveIds ?? []);
    const archivedObjectives = version.area.objectives ?? [];
    for (let index = 0; index < archivedObjectives.length; index += 1) {
      for (const objective of archivedObjectives) {
        if (neededObjectives.has(objective.id))
          for (const prerequisite of objective.prerequisiteIds) neededObjectives.add(prerequisite);
      }
    }
    const historicalObjectives = archivedObjectives.filter(
      (item) => !knownObjectives.has(item.id) && neededObjectives.has(item.id),
    );
    if ((targetArea.objectives?.length ?? 0) + historicalObjectives.length > 200)
      return yield* Effect.fail(
        failure("Restoring these learning objectives would exceed the area limit."),
      );
    const retained = workspace.retainedReviewAreas
      ?.find((item) => item.id === command.areaId)
      ?.cards.find((card) => card.id === command.cardId);
    const freshSchedule = asCopy
      ? yield* Effect.try({
          try: () => newSchedule(now),
          catch: () => failure("A fresh schedule could not be created."),
        })
      : undefined;
    const restored: Assessment = {
      ...version.card,
      id: restoredCardId,
      schedule: freshSchedule ?? current?.schedule ?? retained?.schedule ?? version.card.schedule,
    };
    const withHistory = captureCardVersion(
      workspace,
      targetArea,
      current ?? restored,
      "restore",
      now,
    );
    const nextArea: LearningArea = {
      ...targetArea,
      ...(historicalObjectives.length > 0
        ? { objectives: [...(targetArea.objectives ?? []), ...historicalObjectives] }
        : {}),
      cards: current
        ? targetArea.cards.map((card) => (card.id === restored.id ? restored : card))
        : [...targetArea.cards, restored],
    };
    return {
      ...withHistory,
      areas: recoveredArea
        ? workspace.areas.map((item) => (item.id === recoveredArea.id ? nextArea : item))
        : [...workspace.areas, nextArea],
      deletedCards: asCopy
        ? workspace.deletedCards
        : (workspace.deletedCards ?? []).filter(
            (item) => item.areaId !== command.areaId || item.cardId !== command.cardId,
          ),
      deletedAreas: asCopy
        ? workspace.deletedAreas
        : (workspace.deletedAreas ?? []).filter((item) => item.areaId !== command.areaId),
      retainedReviewAreas: asCopy
        ? workspace.retainedReviewAreas
        : (workspace.retainedReviewAreas ?? [])
            .map((item) =>
              item.id === command.areaId
                ? { ...item, cards: item.cards.filter((card) => card.id !== command.cardId) }
                : item,
            )
            .filter((item) => item.cards.length > 0),
    };
  });
}
