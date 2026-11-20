import type { Assessment, ReviewEventId, SchedulerSettings, Workspace } from "@recall/domain";

export function applyLeechAction(
  settings: SchedulerSettings | undefined,
  policy: SchedulerSettings,
  card: Assessment,
  next: Assessment["schedule"],
  eventId: ReviewEventId,
): SchedulerSettings | undefined {
  if (
    policy.leechAction !== "suspend" ||
    card.schedule.state !== 2 ||
    next.lapses <= card.schedule.lapses ||
    next.lapses < (policy.leechThreshold ?? 8)
  )
    return settings;
  return {
    ...(settings ?? { requestRetention: 0.9 }),
    suspendedCardIds: [...new Set([...(settings?.suspendedCardIds ?? []), card.id])],
    leechSuspensions: { ...settings?.leechSuspensions, [card.id]: eventId },
  };
}

/** A later manual suspension decision clears the review marker and takes precedence. */
export function undoLeechAction(workspace: Workspace, eventId: string): Workspace {
  const settings = workspace.schedulerSettings;
  if (!settings?.leechSuspensions) return workspace;
  const ids = new Set(
    Object.entries(settings.leechSuspensions)
      .filter(([, id]) => id === eventId)
      .map(([id]) => id),
  );
  if (ids.size === 0) return workspace;
  return {
    ...workspace,
    schedulerSettings: {
      ...settings,
      suspendedCardIds: settings.suspendedCardIds?.filter((id) => !ids.has(id)),
      leechSuspensions: Object.fromEntries(
        Object.entries(settings.leechSuspensions).filter(([id]) => !ids.has(id)),
      ),
    },
  };
}
