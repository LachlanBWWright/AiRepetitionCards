import { reviewPlacement, effectiveReviewEvents } from "@recall/domain";
import type { SchedulerSettings, Workspace } from "@recall/domain";

export function studyAncestors(workspace: Workspace, areaId: string): readonly string[] {
  const ancestors: string[] = [];
  let current: string | undefined = areaId;
  while (current && !ancestors.includes(current)) {
    ancestors.push(current);
    current = workspace.schedulerSettings?.areaParents?.[current];
  }
  return ancestors;
}
export function studyScope(workspace: Workspace, areaId: string): readonly string[] {
  return workspace.areas
    .filter((area) => studyAncestors(workspace, area.id).includes(areaId))
    .map((area) => area.id);
}
export function resolveStudySettings(workspace: Workspace, areaId: string): SchedulerSettings {
  const base = workspace.schedulerSettings ?? { requestRetention: 0.9 };
  const presetId = studyAncestors(workspace, areaId)
    .map((id) => base.areaPresets?.[id])
    .find((id) => id !== undefined);
  const preset = base.presets?.find((candidate) => candidate.id === presetId);
  return preset ? { ...base, ...preset.settings } : base;
}
export function reviewParameters(workspace: Workspace, areaId: string, cardId: string) {
  const placement = reviewPlacement(workspace);
  const settings = resolveStudySettings(workspace, areaId);
  const resetAt = (workspace.scheduleAdjustments ?? [])
    .filter(
      (item) =>
        placement.areaId(item) === areaId && item.cardId === cardId && item.kind === "reset",
    )
    .sort(
      (left, right) =>
        left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id),
    )
    .at(-1)?.recordedAt;
  return { ...settings, ...(resetAt ? { resetAt } : {}) };
}
export function presetReviewWorkspace(workspace: Workspace, presetId: string): Workspace {
  const placement = reviewPlacement(workspace);
  const areas = new Set<string>(
    workspace.areas
      .filter(
        (area) =>
          studyAncestors(workspace, area.id)
            .map((id) => workspace.schedulerSettings?.areaPresets?.[id])
            .find((id) => id !== undefined) === presetId,
      )
      .map((area) => area.id),
  );
  return {
    ...workspace,
    reviewEvents: effectiveReviewEvents(workspace).filter((event) =>
      areas.has(placement.areaId(event)),
    ),
  };
}
