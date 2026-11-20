import type { Assessment, Workspace } from "@recall/domain";

export function siblingKey(
  card: Assessment,
  areaId: string,
  noteKeys: ReadonlyMap<string, string>,
): string | undefined {
  if (card.noteId) {
    const key = noteKeys.get(JSON.stringify([areaId, card.noteId]));
    if (key) return key;
  }
  const legacy =
    card.siblingId ??
    (card.cloze ? `cloze:${card.cloze.text}` : undefined) ??
    /^anki:(.+):\d+$/.exec(card.sourceId ?? "")?.[1];
  return legacy === undefined ? undefined : JSON.stringify(["legacy", areaId, legacy]);
}

export function siblingNoteKeys(workspace: Workspace): ReadonlyMap<string, string> {
  return new Map(
    workspace.areas.flatMap((deck) =>
      (deck.noteLibrary?.notes ?? []).map(
        (note) =>
          [
            JSON.stringify([deck.id, note.id]),
            JSON.stringify([
              "note",
              note.source?.areaId ?? deck.id,
              note.source?.noteId ?? note.id,
            ]),
          ] as const,
      ),
    ),
  );
}
