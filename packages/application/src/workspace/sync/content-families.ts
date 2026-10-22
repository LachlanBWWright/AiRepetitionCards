import type { WorkspaceContentPushRequest } from "@recall/contracts";

type Document = WorkspaceContentPushRequest["areas"][number]["document"];
/** Old links keep a family together when a save removes or reroutes its last sibling. */
export function contentFamilies(
  areas: WorkspaceContentPushRequest["areas"],
  previous: readonly Document[],
) {
  const parent = new Map<string, string>(areas.map((area) => [area.document.id, area.document.id]));
  const root = (id: string): string => {
    let current = id;
    while (parent.get(current) && parent.get(current) !== current)
      current = parent.get(current) ?? current;
    return current;
  };
  for (const document of [...previous, ...areas.map((area) => area.document)]) {
    if (!parent.has(document.id)) continue;
    for (const note of document.noteLibrary?.notes ?? []) {
      const source = note.source?.areaId;
      if (source && parent.has(source)) parent.set(root(document.id), root(source));
    }
  }
  const previousCards = new Map(
    previous.flatMap((document) => document.cards.map((card) => [card.id, document.id] as const)),
  );
  for (const area of areas)
    for (const card of area.document.cards) {
      const source = previousCards.get(card.id);
      if (source && parent.has(source)) parent.set(root(area.document.id), root(source));
    }
  const groups = new Map<string, WorkspaceContentPushRequest["areas"][number][]>();
  for (const area of areas) {
    const key = root(area.document.id);
    const group = groups.get(key) ?? [];
    group.push(area);
    groups.set(key, group);
  }
  return [...groups.values()];
}
