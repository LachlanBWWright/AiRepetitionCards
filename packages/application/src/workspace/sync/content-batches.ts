import { Effect } from "effect";
import { MAX_COLLECTION_CARDS, MAX_WORKSPACE_CONTENT_BYTES } from "@recall/domain";
import type { WorkspaceContentPushRequest } from "@recall/contracts";
import { contentFamilies } from "./content-families";
/** Linked subject families remain atomic; independent families use bounded batches. */
export function workspaceContentBatches(
  input: WorkspaceContentPushRequest,
  previous: readonly WorkspaceContentPushRequest["areas"][number]["document"][] = [],
) {
  const batches: WorkspaceContentPushRequest[] = [];
  const tombstoneBytes =
    new TextEncoder().encode(JSON.stringify(input.tombstones.slice(0, 2_000))).byteLength + 512;
  const deleted = new Set(input.tombstones.map((item) => `${item.areaId}:${item.cardId}`));
  let areas: WorkspaceContentPushRequest["areas"][number][] = [];
  let bytes = tombstoneBytes;
  let cards = 0;
  const cleaned = input.areas.map((original) => ({
    ...original,
    document: {
      ...original.document,
      cards: original.document.cards.filter(
        (card) => !deleted.has(`${original.document.id}:${card.id}`),
      ),
    },
  }));
  for (const family of contentFamilies(cleaned, previous)) {
    const size = family.reduce(
      (sum, area) => sum + new TextEncoder().encode(JSON.stringify(area)).byteLength + 1,
      0,
    );
    const count = family.reduce((sum, area) => sum + area.document.cards.length, 0);
    if (
      count > MAX_COLLECTION_CARDS ||
      family.length > 100 ||
      size + tombstoneBytes > MAX_WORKSPACE_CONTENT_BYTES
    )
      return Effect.fail({ _tag: "WorkspaceSyncFailure" as const, reason: "content" as const });
    if (
      areas.length &&
      (bytes + size > 4_500_000 ||
        areas.length + family.length > 100 ||
        cards + count > MAX_COLLECTION_CARDS)
    ) {
      batches.push({ schemaVersion: 1, areas, tombstones: [] });
      areas = [];
      bytes = tombstoneBytes;
      cards = 0;
    }
    areas.push(...family);
    bytes += size;
    cards += count;
  }
  if (areas.length || batches.length === 0)
    batches.push({ schemaVersion: 1, areas, tombstones: [] });
  const included = new Set(input.areas.map((area) => area.document.id));
  const overflow: WorkspaceContentPushRequest["tombstones"][number][] = [];
  const assigned = batches.map((batch, index) => {
    const ids = new Set(batch.areas.map((area) => area.document.id));
    const tombstones = input.tombstones.filter(
      (item) => ids.has(item.areaId) || (index === 0 && !included.has(item.areaId)),
    );
    overflow.push(...tombstones.slice(2_000));
    return { ...batch, tombstones: tombstones.slice(0, 2_000) };
  });
  for (let start = 0; start < overflow.length; start += 2_000)
    assigned.push({
      schemaVersion: 1,
      areas: [],
      tombstones: overflow.slice(start, start + 2_000),
    });
  return Effect.succeed(assigned);
}
