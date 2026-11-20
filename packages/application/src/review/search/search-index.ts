import { createTextPostings, type SearchPostings } from "./search-candidates";
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
  readonly postings: SearchPostings;
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
export function createStudySearchIndex(
  workspace: Workspace,
  previous?: StudySearchIndex,
): StudySearchIndex {
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
  const previousEntries = new Map(previous?.entries.map((entry) => [studyCardKey(entry), entry]));
  let sameTexts = Boolean(previous);
  for (const area of workspace.areas) {
    const notes = new Map((area.noteLibrary?.notes ?? []).map((note) => [note.id, note]));
    const types = new Map((area.noteLibrary?.types ?? []).map((type) => [type.id, type]));
    for (const card of area.cards) {
      const entry = { area, card };
      const key = studyCardKey(entry);
      entries.push(entry);
      const note = notes.get(card.noteId ?? "");
      sources.set(key, { note, type: types.get(note?.typeId ?? "") });
      const old = previousEntries.get(key);
      const oldNote = previous?.sources.get(key)?.note;
      const unchanged =
        old &&
        old.card.front === card.front &&
        old.card.back === card.back &&
        old.card.cloze?.text === card.cloze?.text &&
        old.card.objective === card.objective &&
        old.card.tags === card.tags &&
        oldNote?.fields === note?.fields;
      const cached = unchanged ? previous?.text.get(key) : undefined;
      text.set(
        key,
        cached ??
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
      const oldEntry = previous?.entries[entries.length - 1];
      if (
        !oldEntry ||
        oldEntry.area.id !== area.id ||
        oldEntry.card.id !== card.id ||
        previous.text.get(key) !== text.get(key)
      )
        sameTexts = false;
    }
  }
  const events = new Map<string, ReviewEvent[]>();
  for (const event of effectiveReviewEvents(workspace)) {
    const key = placement.key(event);
    const bucket = events.get(key) ?? [];
    bucket.push(event);
    events.set(key, bucket);
  }
  sameTexts = sameTexts && entries.length === previous?.entries.length;
  return {
    entries,
    events,
    text,
    sources,
    postings: sameTexts && previous ? previous.postings : createTextPostings([...text.values()]),
  };
}

/** Instance-scoped revision cache. No workspace data or caches are shared between consumers. */
export function createStudySearchIndexer(): (workspace: Workspace) => StudySearchIndex {
  let previousWorkspace: Workspace | undefined;
  let previous: StudySearchIndex | undefined;
  return (workspace) => {
    if (workspace === previousWorkspace && previous) return previous;
    previous = createStudySearchIndex(workspace, previous);
    previousWorkspace = workspace;
    return previous;
  };
}
