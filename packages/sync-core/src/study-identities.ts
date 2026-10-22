import {
  createAreaId,
  createAssessmentId,
  createReviewEventId,
  type Assessment,
  type SchedulerSettings,
  type StudySyncDocument,
  type Workspace,
} from "@recall/domain";
type IdMaps = {
  readonly area: (id: string) => string;
  readonly card: (id: string, areaId?: string) => string;
  readonly event: (id: string) => string;
};
export function remapImportedSchedule(
  baseline: NonNullable<Assessment["importedSchedule"]>,
  event: (id: string) => string,
): NonNullable<Assessment["importedSchedule"]> {
  return {
    ...baseline,
    reviewEventIds: baseline.reviewEventIds.map((id) => createReviewEventId(event(id))),
  };
}
/** Local identities can be normalized before first upload, including every private reference. */
export function remapStudyIdentities(workspace: Workspace, ids: IdMaps): Workspace {
  const settings = (value: SchedulerSettings): SchedulerSettings => ({
    ...value,
    ...(value.areaReviewLimits
      ? {
          areaReviewLimits: Object.fromEntries(
            Object.entries(value.areaReviewLimits).map(([id, limit]) => [ids.area(id), limit]),
          ),
        }
      : {}),
    ...(value.dailyLimitOverrides
      ? {
          dailyLimitOverrides: value.dailyLimitOverrides.map((item) => ({
            ...item,
            ...(item.areaId ? { areaId: createAreaId(ids.area(item.areaId)) } : {}),
          })),
        }
      : {}),
    ...(value.suspendedCardIds
      ? { suspendedCardIds: value.suspendedCardIds.map((id) => createAssessmentId(ids.card(id))) }
      : {}),
    ...(value.newCardPositions
      ? {
          newCardPositions: Object.fromEntries(
            Object.entries(value.newCardPositions).map(([id, position]) => [
              ids.card(id),
              position,
            ]),
          ),
        }
      : {}),
    ...(value.areaPresets
      ? {
          areaPresets: Object.fromEntries(
            Object.entries(value.areaPresets).map(([id, preset]) => [ids.area(id), preset]),
          ),
        }
      : {}),
    ...(value.areaParents
      ? {
          areaParents: Object.fromEntries(
            Object.entries(value.areaParents).map(([id, parent]) => [
              ids.area(id),
              ids.area(parent),
            ]),
          ),
        }
      : {}),
    ...(value.filteredDecks
      ? {
          filteredDecks: value.filteredDecks.map((deck) => ({
            ...deck,
            ...(deck.areaId ? { areaId: createAreaId(ids.area(deck.areaId)) } : {}),
          })),
        }
      : {}),
  });
  const adjustments = (value: StudySyncDocument["adjustments"]) =>
    value.map((item) => ({
      ...item,
      areaId: createAreaId(ids.area(item.areaId)),
      cardId: createAssessmentId(ids.card(item.cardId, item.areaId)),
      afterReviewEventId: item.afterReviewEventId
        ? createReviewEventId(ids.event(item.afterReviewEventId))
        : null,
    }));
  const corrections = (value: StudySyncDocument["corrections"]) =>
    value.map((item) => ({ ...item, eventId: createReviewEventId(ids.event(item.eventId)) }));
  const undoStates = (value: StudySyncDocument["undoStates"]) =>
    value.map((item) => ({ ...item, eventId: createReviewEventId(ids.event(item.eventId)) }));
  const importedSchedules = (value: NonNullable<StudySyncDocument["importedSchedules"]>) =>
    value.map((item) => ({
      ...item,
      areaId: createAreaId(ids.area(item.areaId)),
      cardId: createAssessmentId(ids.card(item.cardId, item.areaId)),
      baseline: remapImportedSchedule(item.baseline, ids.event),
    }));
  const card = (value: Assessment): Assessment =>
    value.importedSchedule
      ? { ...value, importedSchedule: remapImportedSchedule(value.importedSchedule, ids.event) }
      : value;
  const area = (value: Workspace["areas"][number]) => ({ ...value, cards: value.cards.map(card) });
  const document = (value: StudySyncDocument): StudySyncDocument => ({
    ...(value.importedSchedules
      ? { importedSchedules: importedSchedules(value.importedSchedules) }
      : {}),
    settings: settings(value.settings),
    adjustments: adjustments(value.adjustments),
    corrections: corrections(value.corrections),
    undoStates: undoStates(value.undoStates),
  });
  return {
    ...workspace,
    areas: workspace.areas.map(area),
    ...(workspace.retainedReviewAreas
      ? { retainedReviewAreas: workspace.retainedReviewAreas.map(area) }
      : {}),
    ...(workspace.cardVersions
      ? {
          cardVersions: workspace.cardVersions.map((version) => ({
            ...version,
            ...(version.movedToAreaId
              ? { movedToAreaId: createAreaId(ids.area(version.movedToAreaId)) }
              : {}),
            card: card(version.card),
            area: area(version.area),
          })),
        }
      : {}),
    ...(workspace.importedScheduleBaselines
      ? { importedScheduleBaselines: importedSchedules(workspace.importedScheduleBaselines) }
      : {}),
    ...(workspace.schedulerSettings
      ? { schedulerSettings: settings(workspace.schedulerSettings) }
      : {}),
    ...(workspace.scheduleAdjustments
      ? { scheduleAdjustments: adjustments(workspace.scheduleAdjustments) }
      : {}),
    ...(workspace.reviewCorrections
      ? { reviewCorrections: corrections(workspace.reviewCorrections) }
      : {}),
    ...(workspace.reviewUndoStates
      ? { reviewUndoStates: undoStates(workspace.reviewUndoStates) }
      : {}),
    ...(workspace.syncStudyBaseline
      ? { syncStudyBaseline: document(workspace.syncStudyBaseline) }
      : {}),
    ...(workspace.studySettingsConflict
      ? {
          studySettingsConflict: {
            local: settings(workspace.studySettingsConflict.local),
            remote: settings(workspace.studySettingsConflict.remote),
          },
        }
      : {}),
  };
}
