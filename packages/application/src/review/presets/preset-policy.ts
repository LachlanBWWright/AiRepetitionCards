import type { SchedulerPolicy, SchedulerSettings } from "@recall/domain";
export function presetPolicy(settings: SchedulerSettings): SchedulerPolicy {
  const policy = { ...settings };
  delete policy.reviewer;
  delete policy.areaReviewLimits;
  delete policy.dailyLimitOverrides;
  delete policy.filteredDecks;
  delete policy.browserColumns;
  delete policy.presets;
  delete policy.areaPresets;
  delete policy.areaParents;
  delete policy.savedSearches;
  delete policy.suspendedCardIds;
  delete policy.newCardPositions;
  delete policy.activeStudyQuery;
  return policy;
}
export function toggleEasyDay(
  policy: SchedulerPolicy,
  index: number,
  reduced: boolean,
): SchedulerPolicy {
  return {
    ...policy,
    easyDays: reduced
      ? [...new Set([...(policy.easyDays ?? []), index])].sort()
      : (policy.easyDays ?? []).filter((day) => day !== index),
  };
}
export function renameStudyPreset(
  settings: SchedulerSettings,
  id: string,
  name: string,
): SchedulerSettings {
  return {
    ...settings,
    presets: (settings.presets ?? []).map((preset) =>
      preset.id === id ? { ...preset, name } : preset,
    ),
  };
}
