import type { ReviewEvent } from "@recall/domain";

export { repairReviewSyncConflicts, prepareWorkspaceForSync } from "./outbox";
export { stableSyncId } from "./ids";

export type OrderedReviewEvents = {
  readonly events: readonly ReviewEvent[];
  readonly concurrentEventIds: ReadonlySet<string>;
};

export function createSyncedReviewEvent(
  workspace: {
    readonly syncDeviceId?: string | undefined;
    readonly reviewEvents?: readonly ReviewEvent[] | undefined;
  },
  event: ReviewEvent,
): ReviewEvent {
  const events = workspace.reviewEvents ?? [];
  const maxSequence = events.reduce(
    (maximum, item) =>
      item.deviceId === workspace.syncDeviceId
        ? Math.max(maximum, item.deviceSequence ?? 0)
        : maximum,
    0,
  );
  return {
    ...event,
    deviceId: workspace.syncDeviceId,
    deviceSequence: maxSequence + 1,
    baseReviewEventId:
      [...events].reverse().find((item) => item.cardId === event.cardId)?.id ?? null,
    reviewedAtDevice: event.ratedAt,
    effectiveReviewedAt: event.ratedAt,
    elapsedMs: null,
    schedulerParameterSetId: null,
    previousStateHash: null,
  };
}

function compareEvents(left: ReviewEvent, right: ReviewEvent): number {
  const time = (left.effectiveReviewedAt ?? left.ratedAt).localeCompare(
    right.effectiveReviewedAt ?? right.ratedAt,
  );
  if (time !== 0) return time;
  const sequence = (left.deviceSequence ?? 0) - (right.deviceSequence ?? 0);
  if (sequence !== 0) return sequence;
  const device = (left.deviceId ?? "").localeCompare(right.deviceId ?? "");
  return device !== 0 ? device : left.id.localeCompare(right.id);
}

/** Orders each card's review DAG causally, using effective time as a stable tie-breaker. */
export function orderReviewEvents(events: readonly ReviewEvent[]): OrderedReviewEvents {
  const byId = new Map(events.map((event) => [event.id, event]));
  const childrenByParent = new Map<string, ReviewEvent[]>();
  const indegree = new Map(events.map((event) => [event.id, 0]));

  for (const event of events) {
    const parentId = event.baseReviewEventId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (!parent || parent.cardId !== event.cardId) continue;
    indegree.set(event.id, (indegree.get(event.id) ?? 0) + 1);
    const children = childrenByParent.get(parent.id) ?? [];
    children.push(event);
    childrenByParent.set(parent.id, children);
  }

  const ready = events.filter((event) => indegree.get(event.id) === 0).sort(compareEvents);
  const ordered: ReviewEvent[] = [];
  while (ready.length > 0) {
    const event = ready.shift();
    if (!event) continue;
    ordered.push(event);
    for (const child of childrenByParent.get(event.id) ?? []) {
      const remaining = (indegree.get(child.id) ?? 0) - 1;
      indegree.set(child.id, remaining);
      if (remaining === 0) {
        ready.push(child);
        ready.sort(compareEvents);
      }
    }
  }

  // A malformed causal cycle still preserves the events instead of dropping history.
  const orderedIds = new Set(ordered.map((event) => event.id));
  ordered.push(...events.filter((event) => !orderedIds.has(event.id)).sort(compareEvents));

  const siblingsByParent = new Map<string, ReviewEvent[]>();
  for (const event of events) {
    const parentId = event.baseReviewEventId ?? "root";
    const key = `${event.cardId}:${parentId}`;
    const siblings = siblingsByParent.get(key) ?? [];
    siblings.push(event);
    siblingsByParent.set(key, siblings);
  }
  const concurrentEventIds = new Set<string>();
  for (const siblings of siblingsByParent.values()) {
    if (siblings.length < 2) continue;
    const devices = new Set(siblings.map((event) => event.deviceId).filter(Boolean));
    if (devices.size < 2) continue;
    for (const sibling of siblings) concurrentEventIds.add(sibling.id);
  }

  return { events: ordered, concurrentEventIds };
}
