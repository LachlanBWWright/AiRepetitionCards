import {
  reviewPlacement,
  effectiveReviewEvents,
  type ReviewEvent,
  type Workspace,
} from "@recall/domain";
import type { StudyCardMatch } from "./card-search";

export const normalizeSearchText = (value: string) => value.normalize("NFKC").toLowerCase();
export const studyCardKey = (entry: StudyCardMatch) =>
  JSON.stringify([entry.area.id, entry.card.id]);
export type StudySearchIndex = {
  readonly entries: readonly StudyCardMatch[];
  readonly events: ReadonlyMap<string, readonly ReviewEvent[]>;
  readonly text: ReadonlyMap<string, string>;
  readonly sources: ReadonlyMap<
    string,
    {
      readonly note: import("@recall/domain").StudyNote | undefined;
      readonly type: import("@recall/domain").NoteType | undefined;
    }
  >;
};
/** Build once per immutable workspace revision, then reuse across query and page changes. */
export function createStudySearchIndex(workspace: Workspace): StudySearchIndex {
  const placement = reviewPlacement(workspace);
  const entries: StudyCardMatch[] = [];
  const text = new Map<string, string>();
  const sources = new Map<
    string,
    {
      readonly note: import("@recall/domain").StudyNote | undefined;
      readonly type: import("@recall/domain").NoteType | undefined;
    }
  >();
  for (const area of workspace.areas) {
    const notes = new Map((area.noteLibrary?.notes ?? []).map((note) => [note.id, note]));
    const types = new Map((area.noteLibrary?.types ?? []).map((type) => [type.id, type]));
    for (const card of area.cards) {
      const entry = { area, card };
      entries.push(entry);
      const note = notes.get(card.noteId ?? "");
      sources.set(studyCardKey(entry), { note, type: types.get(note?.typeId ?? "") });
      text.set(
        studyCardKey(entry),
        normalizeSearchText(
          [
            card.front,
            card.back,
            card.cloze?.text,
            card.objective,
            ...(card.tags ?? []),
            ...Object.values(notes.get(card.noteId ?? "")?.fields ?? {}),
          ].join(" "),
        ),
      );
    }
  }
  const events = new Map<string, ReviewEvent[]>();
  for (const event of effectiveReviewEvents(workspace)) {
    const key = placement.key(event);
    const bucket = events.get(key) ?? [];
    bucket.push(event);
    events.set(key, bucket);
  }
  return { entries, events, text, sources };
}
