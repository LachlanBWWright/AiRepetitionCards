export { deriveEffectiveReviewTime } from "./review-clock";
export type { ReviewClockFailure, EffectiveReviewTime } from "./review-clock";
import type { ReviewEvent } from "@recall/domain";
import { createDeviceId } from "@recall/domain";
import type { SyncPullResponse } from "@recall/contracts";

export { repairReviewSyncConflicts, prepareWorkspaceForSync } from "./outbox";
export { stableSyncId } from "./ids";

/** Reject pages whose cursor could skip unapplied changes or replay an older range. */
export function isValidSyncPullPage(page: SyncPullResponse, previousCursor: string): boolean {
  if (!/^\d{1,20}$/.test(previousCursor) || !/^\d{1,20}$/.test(page.cursor)) return false;
  const previousSequence = BigInt(previousCursor);
  const cursor = BigInt(page.cursor);
  if (cursor < previousSequence || (page.hasMore && page.changes.length === 0)) return false;
  if (page.changes.length === 0) return cursor === previousSequence;
  let lastSequence = previousSequence;
  for (const change of page.changes) {
    const sequence = BigInt(change.sequence);
    if (sequence <= lastSequence) return false;
    lastSequence = sequence;
  }
  return cursor === lastSequence;
}

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
    ...(workspace.syncDeviceId ? { deviceId: createDeviceId(workspace.syncDeviceId) } : {}),
    deviceSequence: maxSequence + 1,
    baseReviewEventId:
      [...events].reverse().find((item) => item.cardId === event.cardId)?.id ?? null,
    reviewedAtDevice: event.ratedAt,
    effectiveReviewedAt: event.ratedAt,
    elapsedMs: event.elapsedMs ?? null,
    schedulerParameterSetId: event.schedulerParameterSetId ?? null,
    previousStateHash: event.previousStateHash ?? null,
  };
}

function compareEvents(left: ReviewEvent, right: ReviewEvent): number {
  const leftTime = Date.parse(left.effectiveReviewedAt ?? left.ratedAt);
  const rightTime = Date.parse(right.effectiveReviewedAt ?? right.ratedAt);
  const time =
    Number.isFinite(leftTime) && Number.isFinite(rightTime)
      ? leftTime - rightTime
      : (left.effectiveReviewedAt ?? left.ratedAt).localeCompare(
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
