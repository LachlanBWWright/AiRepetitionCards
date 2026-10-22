import { effectiveReviewEvents } from "./effective-reviews";
import type { Workspace } from "./index";

type CardReference = { readonly areaId: string; readonly cardId: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** UUIDs are global. Legacy aliases cross decks only through explicit append-only move evidence. */
export function reviewPlacement(workspace: Workspace) {
  const locations = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const area of [...workspace.areas, ...(workspace.retainedReviewAreas ?? [])])
    for (const card of area.cards) {
      if (locations.has(card.id)) ambiguous.add(card.id);
      locations.set(card.id, area.id);
    }
  const moves = new Map<string, Map<string, Set<string>>>();
  for (const version of workspace.cardVersions ?? []) {
    if (version.reason !== "move" || !version.movedToAreaId) continue;
    const edges = moves.get(version.cardId) ?? new Map<string, Set<string>>();
    const destinations = edges.get(version.areaId) ?? new Set<string>();
    destinations.add(version.movedToAreaId);
    edges.set(version.areaId, destinations);
    moves.set(version.cardId, edges);
  }
  const connected = (cardId: string, source: string, target: string): boolean => {
    const visited = new Set<string>();
    const pending = [source];
    for (const area of pending) {
      if (area === target) return true;
      if (visited.has(area)) continue;
      visited.add(area);
      pending.push(...(moves.get(cardId)?.get(area) ?? []));
    }
    return false;
  };
  const areaId = (reference: CardReference) => {
    const current = locations.get(reference.cardId);
    if (!current || ambiguous.has(reference.cardId)) return reference.areaId;
    return uuid.test(reference.cardId) || connected(reference.cardId, reference.areaId, current)
      ? current
      : reference.areaId;
  };
  const identityAreaId = (reference: CardReference) => {
    const current = areaId(reference);
    for (const source of moves.get(reference.cardId)?.keys() ?? [])
      if (connected(reference.cardId, source, current)) return source;
    return current;
  };
  return {
    areaId,
    identityAreaId,
    key: (reference: CardReference) => JSON.stringify([areaId(reference), reference.cardId]),
  };
}

/** Effective history follows current placement without altering its historical area provenance. */
export function reviewEventsInArea(workspace: Workspace, areaId: string | undefined) {
  if (areaId === undefined) return [];
  const placement = reviewPlacement(workspace);
  return effectiveReviewEvents(workspace).filter((event) => placement.areaId(event) === areaId);
}
