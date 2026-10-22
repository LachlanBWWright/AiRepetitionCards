import { reviewPlacement, type LearningArea, type Workspace } from "@recall/domain";
/** Keep private correction/adjustment evidence with a private deck export, never public copies. */
export function privateDeckHistory(workspace: Workspace, area: LearningArea) {
  const placement = reviewPlacement(workspace);
  const reviews = (workspace.reviewEvents ?? []).filter(
    (event) => placement.areaId(event) === area.id,
  );
  const ids = new Set(reviews.map((event) => event.id));
  return {
    currentArea: area,
    reviewEvents: reviews,
    cardVersions:
      workspace.cardVersions?.filter((version) => placement.areaId(version) === area.id) ?? [],
    reviewCorrections: workspace.reviewCorrections?.filter((item) => ids.has(item.eventId)) ?? [],
    reviewUndoStates: workspace.reviewUndoStates?.filter((item) => ids.has(item.eventId)) ?? [],
    scheduleAdjustments:
      workspace.scheduleAdjustments?.filter((item) => placement.areaId(item) === area.id) ?? [],
    ...(workspace.activityLibrary ? { activityLibrary: workspace.activityLibrary } : {}),
  };
}
