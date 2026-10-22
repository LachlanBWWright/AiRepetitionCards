import { resolveNoteSource } from "../../notes/ownership";
import { Effect } from "effect";
import type { Assessment, StudyNote, Workspace } from "@recall/domain";
import { saveStudyNote } from "../../notes/save";

export function previewNoteFieldReplacement(
  workspace: Workspace,
  areaId: string,
  card: Assessment,
  field: string,
  find: string,
  replacement: string,
) {
  const area = workspace.areas.find((item) => item.id === areaId);
  const source = area ? resolveNoteSource(workspace, area, card.noteId) : undefined;
  const note = source?.area.noteLibrary?.notes.find((item) => item.id === source.noteId);
  const before = note?.fields[field];
  if (!find || before === undefined || !before.includes(find)) return undefined;
  const after = before.replaceAll(find, replacement);
  return before === after ? undefined : { before, after };
}
/** One atomic proposal per source note, regardless of how many siblings match the search. */
export function replaceNoteFields(
  workspace: Workspace,
  areaId: string,
  cardIds: readonly string[],
  field: string,
  find: string,
  replacement: string,
  now: Date,
) {
  return Effect.gen(function* () {
    const area = workspace.areas.find((item) => item.id === areaId);
    const selected = new Set(cardIds);
    const sources = new Map<string, { readonly areaId: string; readonly note: StudyNote }>();
    for (const card of area?.cards ?? []) {
      if (!selected.has(card.id) || !area) continue;
      const source = resolveNoteSource(workspace, area, card.noteId);
      const note = source.area.noteLibrary?.notes.find((item) => item.id === source.noteId);
      if (note)
        sources.set(JSON.stringify([source.area.id, note.id]), { areaId: source.area.id, note });
    }
    let next = workspace;
    for (const { areaId: sourceAreaId, note } of sources.values()) {
      const before = note.fields[field];
      if (before === undefined || !find || !before.includes(find)) continue;
      next = yield* saveStudyNote(
        next,
        {
          areaId: sourceAreaId,
          note: {
            ...note,
            fields: { ...note.fields, [field]: before.replaceAll(find, replacement) },
          },
          cardIds: [],
        },
        now,
      );
    }
    return next;
  });
}
