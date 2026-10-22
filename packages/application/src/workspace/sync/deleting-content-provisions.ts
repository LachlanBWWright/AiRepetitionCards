import type { Snapshot } from "./workspace-sync-snapshots";

/** Keep old family members available until the later owner-scoped area tombstone. */
export function deletingContentProvisions(before: Snapshot, deletedIds: ReadonlySet<string>) {
  return before.areas
    .filter(
      (area) =>
        deletedIds.has(area.document.id) && !before.deletedAreaIds.includes(area.document.id),
    )
    .map((area) => ({ ...area, baseContentHash: area.contentHash }));
}
