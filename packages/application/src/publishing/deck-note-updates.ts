import { Effect } from "effect";
import {
  createObjectiveId,
  type KnowledgeArea,
  type NoteLibrary,
  type StudyNote,
} from "@recall/domain";
import type { DeckUpdateFailure } from "./deck-updates";
const identity = (item: { readonly id: string; readonly sourceId?: string | undefined }) =>
  item.sourceId ?? item.id;
export function canonicalNoteValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalNoteValue).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalNoteValue(item)}`)
      .join(",")}}`;
  return value === undefined ? "null" : JSON.stringify(value);
}
function stableNote(note: StudyNote | undefined, area: KnowledgeArea) {
  return note
    ? {
        ...note,
        objectiveIds: note.objectiveIds
          .map((id) => {
            const objective = area.objectives.find((item) => item.id === id);
            return objective ? identity(objective) : id;
          })
          .sort(),
      }
    : undefined;
}
/** A note/type-only edit still changes every generated card's editable source. */
export function cardNoteSignature(area: KnowledgeArea, noteId?: string): string {
  const note = area.noteLibrary?.notes.find((item) => item.id === noteId);
  return canonicalNoteValue({
    note: stableNote(note, area),
    type: area.noteLibrary?.types.find((item) => item.id === note?.typeId),
  });
}
function invalidLinks(area: KnowledgeArea): boolean {
  const notes = new Map((area.noteLibrary?.notes ?? []).map((item) => [item.id, item]));
  const types = new Map((area.noteLibrary?.types ?? []).map((item) => [item.id, item]));
  const objectiveIds = new Set(area.objectives.map((item) => item.id));
  return (
    [...notes.values()].some((note) => note.objectiveIds.some((id) => !objectiveIds.has(id))) ||
    area.cards.some((card) => {
      if (!card.noteId) return card.templateId !== undefined;
      const note = notes.get(card.noteId);
      return (
        !note ||
        !types.get(note.typeId)?.templates.some((template) => template.id === card.templateId)
      );
    })
  );
}
export function mergeDeckNoteLibrary(input: {
  readonly base: KnowledgeArea;
  readonly local: KnowledgeArea;
  readonly remote: KnowledgeArea;
  readonly cards: KnowledgeArea["cards"];
  readonly objectives: KnowledgeArea["objectives"];
  readonly selected: ReadonlySet<string>;
  readonly confirmed: ReadonlySet<string>;
  readonly objectiveIdByRemoteId: ReadonlyMap<string, string>;
}): Effect.Effect<
  { readonly noteLibrary: NoteLibrary | undefined; readonly modified: readonly string[] },
  DeckUpdateFailure
> {
  return Effect.gen(function* () {
    const { base, local, remote, selected, confirmed } = input;
    if ([base, local, remote].some(invalidLinks))
      return yield* Effect.fail({ _tag: "DeckUpdateFailure", reason: "invalid-input" } as const);
    const areas = [base, local, remote];
    const allCards = areas.flatMap((area) => area.cards);
    const family = (noteId: string) => [
      ...new Set(allCards.filter((card) => card.noteId === noteId).map(identity)),
    ];
    const notes = (area: KnowledgeArea) =>
      new Map((area.noteLibrary?.notes ?? []).map((item) => [item.id, item]));
    const types = (area: KnowledgeArea) =>
      new Map((area.noteLibrary?.types ?? []).map((item) => [item.id, item]));
    const baseNotes = notes(base),
      localNotes = notes(local),
      remoteNotes = notes(remote);
    const baseTypes = types(base),
      localTypes = types(local),
      remoteTypes = types(remote);
    const touched = new Set(
      allCards
        .filter((card) => card.noteId && selected.has(identity(card)))
        .flatMap((card) => (card.noteId ? [card.noteId] : [])),
    );
    const fail = (ids: readonly string[], message: string): DeckUpdateFailure => ({
      _tag: "DeckUpdateFailure",
      reason: "local-conflict",
      sourceIds: [...new Set(ids)].sort(),
      message,
    });
    const changed = <A>(before: ReadonlyMap<string, A>, after: ReadonlyMap<string, A>) =>
      [...new Set([...before.keys(), ...after.keys()])].filter(
        (id) => canonicalNoteValue(before.get(id)) !== canonicalNoteValue(after.get(id)),
      );
    const unsupportedNote = changed(baseNotes, remoteNotes).find((id) => family(id).length === 0);
    const unsupportedType = changed(baseTypes, remoteTypes).find(
      (id) =>
        !allCards.some(
          (card) =>
            card.noteId &&
            areas.some((area) =>
              area.noteLibrary?.notes.some((note) => note.id === card.noteId && note.typeId === id),
            ),
        ),
    );
    if (selected.size > 0 && (unsupportedNote || unsupportedType))
      return yield* Effect.fail(
        fail(
          [...selected],
          "This release changes notes or types without generated cards. Add a fresh personal copy to receive those changes safely.",
        ),
      );
    for (const id of touched) {
      const members = family(id);
      if (members.some((member) => !selected.has(member)))
        return yield* Effect.fail(
          fail(
            members,
            "Select every generated card in the shared-note family before applying this update.",
          ),
        );
    }
    const touchedTypes = new Set(
      [...touched].flatMap((id) =>
        remoteNotes.get(id)?.typeId ? [remoteNotes.get(id)?.typeId ?? ""] : [],
      ),
    );
    for (const id of touchedTypes) {
      const replacement = remoteTypes.get(id);
      if (canonicalNoteValue(replacement) === canonicalNoteValue(localTypes.get(id))) continue;
      const dependentNotes = [
        ...new Set(
          areas.flatMap(
            (area) =>
              area.noteLibrary?.notes.filter((note) => note.typeId === id).map((note) => note.id) ??
              [],
          ),
        ),
      ];
      const families = dependentNotes.flatMap(family);
      if (
        dependentNotes.some((noteId) => !remoteNotes.has(noteId)) ||
        families.some((member) => !selected.has(member))
      )
        return yield* Effect.fail(
          fail(
            families.length ? families : [...selected],
            "This type change also affects other shared notes. Select all affected families; local-only notes using this type require a separate personal copy.",
          ),
        );
    }
    const modified = new Set<string>();
    for (const id of touched) {
      const before = canonicalNoteValue(stableNote(baseNotes.get(id), base));
      const current = canonicalNoteValue(stableNote(localNotes.get(id), local));
      if (
        before !== current &&
        current !== canonicalNoteValue(stableNote(remoteNotes.get(id), remote))
      )
        family(id).forEach((member) => modified.add(member));
    }
    for (const id of touchedTypes) {
      const before = canonicalNoteValue(baseTypes.get(id));
      const current = canonicalNoteValue(localTypes.get(id));
      if (before !== current && current !== canonicalNoteValue(remoteTypes.get(id))) {
        for (const noteId of touched)
          if (remoteNotes.get(noteId)?.typeId === id)
            family(noteId).forEach((member) => modified.add(member));
      }
    }
    const unconfirmed = [...modified].filter((id) => !confirmed.has(id));
    if (unconfirmed.length)
      return yield* Effect.fail(
        fail(
          unconfirmed,
          "Shared notes or templates have local edits. Confirm replacing every affected family, or keep the local version.",
        ),
      );
    const updatedNotes = new Map(localNotes);
    for (const id of touched) {
      const note = remoteNotes.get(id);
      if (!note) {
        updatedNotes.delete(id);
        continue;
      }
      updatedNotes.set(id, {
        ...note,
        objectiveIds: note.objectiveIds.map((objective) =>
          createObjectiveId(input.objectiveIdByRemoteId.get(objective) ?? objective),
        ),
      });
    }
    const updatedTypes = new Map(localTypes);
    for (const id of touchedTypes) {
      const type = remoteTypes.get(id);
      if (type) updatedTypes.set(id, type);
    }
    const noteLibrary =
      local.noteLibrary || remote.noteLibrary
        ? { notes: [...updatedNotes.values()], types: [...updatedTypes.values()] }
        : undefined;
    const result = {
      ...local,
      objectives: input.objectives,
      cards: input.cards,
      ...(noteLibrary ? { noteLibrary } : {}),
    };
    if (invalidLinks(result))
      return yield* Effect.fail(
        fail(
          [...selected],
          "The selected update would leave a missing shared note, template, or objective. Include the required changes.",
        ),
      );
    return { noteLibrary, modified: [...modified] };
  });
}
