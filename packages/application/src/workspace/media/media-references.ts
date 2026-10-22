import type { MediaReference, Workspace } from "@recall/domain";
export function areaMediaReferences(area: {
  readonly cards: readonly { readonly media?: readonly MediaReference[] | undefined }[];
  readonly noteLibrary?:
    | { readonly notes: readonly { readonly media?: readonly MediaReference[] | undefined }[] }
    | undefined;
}): readonly MediaReference[] {
  return [
    ...new Map(
      [
        ...area.cards.flatMap((card) => card.media ?? []),
        ...(area.noteLibrary?.notes.flatMap((note) => note.media ?? []) ?? []),
      ].map((reference) => [reference.id, reference]),
    ).values(),
  ];
}
/** Historical snapshots and retained deletions are live references for recovery purposes. */
export function workspaceMediaReferences(workspace: Workspace): readonly MediaReference[] {
  return [
    ...new Map(
      [
        ...[...workspace.areas, ...(workspace.retainedReviewAreas ?? [])].flatMap(
          areaMediaReferences,
        ),
        ...(workspace.cardVersions ?? []).flatMap((version) => [
          ...(version.card.media ?? []),
          ...areaMediaReferences(version.area),
        ]),
      ].map((reference) => [reference.id, reference]),
    ).values(),
  ];
}
