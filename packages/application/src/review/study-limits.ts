import { reviewPlacement } from "@recall/domain";
import type { AreaId, ReviewEvent, SchedulerSettings, Workspace } from "@recall/domain";
import { studyAncestors, studyScope, resolveStudySettings } from "./presets/resolve-settings";
import type { StudyDay } from "./study-queue";

/** Overrides carry their creating device's exact calendar-day boundaries across sync. */
export function todayStudyLimits(
  settings: SchedulerSettings,
  day: StudyDay,
  limits: { readonly dailyNewLimit?: number; readonly dailyReviewLimit?: number },
  areaId?: AreaId,
): SchedulerSettings {
  return {
    ...settings,
    dailyLimitOverrides: [
      ...(settings.dailyLimitOverrides ?? []).filter(
        (item) => item.endsAt > day.startsAt && item.areaId !== areaId,
      ),
      { ...limits, ...day, ...(areaId ? { areaId } : {}) },
    ],
  };
}

export function reviewBudget(
  workspace: Workspace,
  areaId: string,
  day: StudyDay,
  events: readonly ReviewEvent[],
  now: number,
) {
  const placement = reviewPlacement(workspace);
  const settings = workspace.schedulerSettings;
  const at = (event: ReviewEvent) => Date.parse(event.effectiveReviewedAt ?? event.ratedAt);
  const beforeToday = new Set(
    events.filter((event) => at(event) < day.startsAt).map((event) => placement.key(event)),
  );
  // A returning card consumes one slot per day; retries never consume extra slots.
  // Preview answers are not review events and therefore cannot consume the budget.
  const snapshots = new Map(
    (workspace.reviewUndoStates ?? []).map((item) => [item.eventId, item.schedule]),
  );
  const reviewed = new Map(
    events
      .filter((event) => at(event) >= day.startsAt && at(event) < day.endsAt)
      .filter((event) => {
        const snapshot = snapshots.get(event.id);
        return snapshot ? snapshot.state === 2 : beforeToday.has(placement.key(event));
      })
      .map((event) => [placement.key(event), event]),
  );
  const override = (id?: string) =>
    settings?.dailyLimitOverrides?.find(
      (item) => item.areaId === id && item.startsAt <= now && item.endsAt > now,
    );
  const remaining = (limit: number, scope?: ReadonlySet<string>) =>
    Math.max(
      0,
      limit -
        [...reviewed.values()].filter((event) => !scope || scope.has(placement.areaId(event)))
          .length,
    );
  const ancestors = studyAncestors(workspace, areaId);
  const scopeLimits = ancestors.map((id) => {
    const policy = resolveStudySettings(workspace, id);
    const limit =
      override(id)?.dailyReviewLimit ??
      settings?.areaReviewLimits?.[id] ??
      (settings?.areaPresets?.[id] ? policy.dailyReviewLimit : undefined) ??
      Infinity;
    return remaining(limit, new Set(studyScope(workspace, id)));
  });
  return {
    remaining: Math.min(
      remaining(override()?.dailyReviewLimit ?? settings?.dailyReviewLimit ?? Infinity),
      ...scopeLimits,
    ),
    reviewedToday: reviewed.size,
    reviewedCardIds: new Set(
      [...reviewed.values()]
        .filter((event) => placement.areaId(event) === areaId)
        .map((event) => event.cardId),
    ),
    globalNewLimit: override()?.dailyNewLimit ?? settings?.dailyNewLimit ?? 20,
    newLimitFor: (id: string) =>
      override(id)?.dailyNewLimit ?? resolveStudySettings(workspace, id).dailyNewLimit ?? 20,
  };
}
