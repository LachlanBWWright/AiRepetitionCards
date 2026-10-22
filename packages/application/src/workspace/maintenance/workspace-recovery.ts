import { Effect, Schema } from "effect";
import { parseWorkspaceJson, WorkspaceSchema, type Workspace } from "@recall/domain";
import { rebuildWorkspaceSchedules } from "../../review/schedule-replay";

export const RestoreWorkspaceCheckpointSchema = Schema.Struct({
  kind: Schema.Literal("restore-workspace-checkpoint"),
  serializedWorkspace: Schema.String,
});
export const RepairCollectionReferencesSchema = Schema.Struct({
  kind: Schema.Literal("repair-collection-references"),
});
const failure = {
  message: "This checkpoint could not be safely restored. Export a backup before trying again.",
};
/** Restore content while retaining all current immutable history and account ownership. */
export function restoreWorkspaceCheckpoint(workspace: Workspace, serialized: string) {
  return Effect.gen(function* () {
    const parsed = yield* parseWorkspaceJson(serialized).pipe(Effect.mapError(() => failure));
    const restored = yield* Schema.decodeUnknown(WorkspaceSchema)(parsed).pipe(
      Effect.mapError(() => failure),
    );
    if ((restored.syncOwnerId ?? null) !== (workspace.syncOwnerId ?? null))
      return yield* Effect.fail({ message: "This checkpoint belongs to a different account." });
    const merge = <T extends { readonly id: string }>(
      older: readonly T[] = [],
      newer: readonly T[] = [],
    ) => [...new Map([...older, ...newer].map((entry) => [entry.id, entry])).values()];
    const events = merge(restored.reviewEvents, workspace.reviewEvents);
    const areas = merge(
      workspace.areas,
      restored.areas.map((area) => ({
        ...area,
        cards: merge(workspace.areas.find((entry) => entry.id === area.id)?.cards, area.cards),
        objectives: merge(
          workspace.areas.find((entry) => entry.id === area.id)?.objectives,
          area.objectives,
        ),
        noteLibrary: area.noteLibrary
          ? {
              ...area.noteLibrary,
              notes: merge(
                workspace.areas.find((entry) => entry.id === area.id)?.noteLibrary?.notes,
                area.noteLibrary.notes,
              ),
              types: merge(
                workspace.areas.find((entry) => entry.id === area.id)?.noteLibrary?.types,
                area.noteLibrary.types,
              ),
            }
          : workspace.areas.find((entry) => entry.id === area.id)?.noteLibrary,
      })),
    );
    const activeIds = new Set(areas.flatMap((area) => area.cards.map((card) => card.id)));
    const candidate: Workspace = {
      ...workspace,
      areas,
      schedulerSettings: restored.schedulerSettings ?? workspace.schedulerSettings,
      reviewEvents: events,
      reviewUndoStates: [
        ...new Map(
          [...(restored.reviewUndoStates ?? []), ...(workspace.reviewUndoStates ?? [])].map(
            (entry) => [entry.eventId, entry],
          ),
        ).values(),
      ],
      reviews: events.length || workspace.reviews,
      reviewCorrections: merge(restored.reviewCorrections, workspace.reviewCorrections),
      scheduleAdjustments: merge(restored.scheduleAdjustments, workspace.scheduleAdjustments),
      cardVersions: merge(restored.cardVersions, workspace.cardVersions),
      deletedAreas: workspace.deletedAreas?.filter(
        (entry) => !areas.some((area) => area.id === entry.areaId),
      ),
      deletedCards: workspace.deletedCards?.filter((entry) => !activeIds.has(entry.cardId)),
      retainedReviewAreas: (workspace.retainedReviewAreas ?? [])
        .map((area) => ({ ...area, cards: area.cards.filter((card) => !activeIds.has(card.id)) }))
        .filter((area) => area.cards.length > 0),
    };
    return yield* rebuildWorkspaceSchedules(candidate).pipe(Effect.mapError(() => failure));
  });
}
/** Repair only references with an unambiguous safe outcome; never fabricate notes or media. */
export function repairCollectionReferences(workspace: Workspace) {
  const candidate = {
    ...workspace,
    reviews: workspace.reviewEvents?.length ?? workspace.reviews,
    areas: workspace.areas.map((area) => ({
      ...area,
      cards: area.cards.map((card) => ({
        ...card,
        objectiveIds: card.objectiveIds?.filter((id) =>
          area.objectives?.some((objective) => objective.id === id),
        ),
      })),
    })),
  };
  return Schema.decodeUnknown(WorkspaceSchema)(candidate).pipe(
    Effect.mapError(() => ({
      message: "The collection needs manual repair. Existing data was preserved.",
    })),
  );
}
