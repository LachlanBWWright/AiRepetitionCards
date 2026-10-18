import type { Assessment, Workspace } from "@recall/domain";

export function createEmptyWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    reviews: 0,
    reviewEvents: [],
    areas: [],
  };
}

export function dueNow(card: Assessment, now: number): boolean {
  return Date.parse(card.schedule.due) <= now;
}
