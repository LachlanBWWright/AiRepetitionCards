import type { ReviewEvent, Workspace } from "./index";
/** Corrections are append-only; all scheduling consumers ignore their target answers. */
export function effectiveReviewEvents(workspace: Workspace): readonly ReviewEvent[] {
  const undone = new Set(workspace.reviewCorrections?.map((item) => item.eventId));
  return (workspace.reviewEvents ?? []).filter((event) => !undone.has(event.id));
}
