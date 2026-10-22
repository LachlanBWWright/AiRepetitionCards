import { captureCardVersion } from "../card-history";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Effect } from "effect";
import {
  createObjectiveId,
  createAreaId,
  MAX_COLLECTION_CARDS,
  MAX_COLLECTION_NOTES,
  type Assessment,
  type LearningArea,
  type NoteLibrary,
  type Workspace,
} from "@recall/domain";
import { noteCardKey, previewStudyNote, noteFailure } from "./preview";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => canonical(item));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
const digest = (value: unknown) =>
  bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(canonical(value)))));
const snapshotId = (areaId: string, kind: string, id: string) =>
  `linked-${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([areaId, kind, id]))))}`;
/** Destination snapshots remain independently publishable; only private editing follows ownership. */
export function resolveNoteSource(workspace: Workspace, area: LearningArea, noteId?: string) {
  const note = area.noteLibrary?.notes.find((item) => item.id === noteId);
  const source = note?.source;
  const owner = source ? workspace.areas.find((item) => item.id === source.areaId) : undefined;
  const canonical = owner?.noteLibrary?.notes.find(
    (item) => item.id === source?.noteId && !item.source,
  );
  return owner && canonical ? { area: owner, noteId: canonical.id } : { area, noteId };
}
export function collectNoteArea(workspace: Workspace, owner: LearningArea): LearningArea {
  const notes = new Map(
    (owner.noteLibrary?.notes ?? []).filter((note) => !note.source).map((note) => [note.id, note]),
  );
  const cards = [...owner.cards];
  for (const area of workspace.areas) {
    if (area.id === owner.id) continue;
    const sources = new Map(
      (area.noteLibrary?.notes ?? [])
        .filter((note) => note.source?.areaId === owner.id)
        .map((note) => [note.id, note.source?.noteId]),
    );
    for (const card of area.cards) {
      const noteId = card.noteId ? sources.get(card.noteId) : undefined;
      const note = noteId ? notes.get(noteId) : undefined;
      if (note) cards.push({ ...card, noteId: note.id, objectiveIds: note.objectiveIds });
    }
  }
  return { ...owner, cards };
}
export function noteCardLocations(workspace: Workspace) {
  return new Map(
    workspace.areas.flatMap((area) => area.cards.map((card) => [card.id, { area, card }] as const)),
  );
}
/** Splits regenerated content; card identity and append-only review evidence survive placement. */
export function placeNoteCards(updated: Workspace, owner: LearningArea, now: Date) {
  return Effect.gen(function* () {
    let nextWorkspace = updated;
    const locations = noteCardLocations(updated);
    const library = owner.noteLibrary ?? { types: [], notes: [] };
    const notes = new Map(library.notes.map((note) => [note.id, note]));
    const types = new Map(library.types.map((type) => [type.id, type]));
    const destinations = new Set(updated.areas.map((area) => area.id));
    const generatedIds = new Set(owner.cards.map((card) => card.id));
    const grouped = new Map<string, Assessment[]>();
    for (const card of owner.cards) {
      const note = card.noteId ? notes.get(card.noteId) : undefined;
      const template = note
        ? types.get(note.typeId)?.templates.find((item) => item.id === card.templateId)
        : undefined;
      const destination = note?.source ? owner.id : (template?.deckAreaId ?? owner.id);
      if (!destinations.has(destination))
        return yield* Effect.fail(
          noteFailure("A card template's destination subject no longer exists."),
        );
      const previous = locations.get(card.id);
      if (previous && previous.area.id !== destination)
        nextWorkspace = captureCardVersion(
          nextWorkspace,
          previous.area,
          previous.card,
          "move",
          now,
          createAreaId(destination),
        );
      const group = grouped.get(destination) ?? [];
      group.push(card);
      grouped.set(destination, group);
    }
    const areas = updated.areas.map((area) => {
      const incoming = grouped.get(area.id) ?? [];
      if (area.id === owner.id) return { ...area, noteLibrary: library, cards: incoming };
      const baseCards = area.cards.filter((card) => !generatedIds.has(card.id));
      const hasSnapshots = area.noteLibrary?.notes.some((note) => note.source?.areaId === owner.id);
      if (!incoming.length && !hasSnapshots) return { ...area, cards: baseCards };
      const next = snapshotDestination(area, owner, incoming, library);
      return { ...next, cards: [...baseCards, ...next.cards] };
    });
    if (
      areas.some(
        (area) =>
          area.cards.length > MAX_COLLECTION_CARDS ||
          (area.noteLibrary?.notes.length ?? 0) > MAX_COLLECTION_NOTES ||
          (area.noteLibrary?.types.length ?? 0) > 100,
      )
    )
      return yield* Effect.fail(
        noteFailure("A destination subject would exceed its card, note or note-type capacity."),
      );
    return { ...nextWorkspace, areas };
  });
}
function snapshotDestination(
  area: LearningArea,
  owner: LearningArea,
  cards: readonly Assessment[],
  library: NoteLibrary,
): LearningArea {
  const noteIds = new Set(cards.flatMap((card) => (card.noteId ? [card.noteId] : [])));
  const notes = library.notes.filter((note) => noteIds.has(note.id));
  const typeIds = new Set(notes.map((note) => note.typeId));
  const objectiveId = (id: string) => createObjectiveId(snapshotId(owner.id, "objective", id));
  const objectives = (owner.objectives ?? []).map((objective) => ({
    ...objective,
    id: objectiveId(objective.id),
    prerequisiteIds: objective.prerequisiteIds.map(objectiveId),
  }));
  const previous = area.noteLibrary ?? { types: [], notes: [] };
  const mirrors = new Set(
    previous.notes.filter((note) => note.source?.areaId === owner.id).map((note) => note.id),
  );
  const keepNotes = previous.notes.filter((note) => !mirrors.has(note.id));
  const keepTypes = new Set(keepNotes.map((note) => note.typeId));
  return {
    ...area,
    objectives: [
      ...(area.objectives ?? []).filter(
        (objective) => !objectives.some((item) => item.id === objective.id),
      ),
      ...(notes.length ? objectives : []),
    ],
    noteLibrary: {
      types: [
        ...previous.types.filter(
          (type) =>
            keepTypes.has(type.id) ||
            !previous.notes.some((note) => mirrors.has(note.id) && note.typeId === type.id),
        ),
        ...library.types
          .filter((type) => typeIds.has(type.id))
          .map((type) => ({ ...type, id: snapshotId(owner.id, "type", type.id) })),
      ],
      notes: [
        ...keepNotes,
        ...notes.map((note) => ({
          ...note,
          id: snapshotId(owner.id, "note", note.id),
          typeId: snapshotId(owner.id, "type", note.typeId),
          source: {
            areaId: owner.id,
            noteId: note.id,
            revision: digest({
              note,
              type: library.types.find((type) => type.id === note.typeId),
              objectives: owner.objectives ?? [],
            }),
          },
          objectiveIds: note.objectiveIds.map(objectiveId),
        })),
      ],
    },
    cards: cards.map((card) => ({
      ...card,
      noteId: card.noteId ? snapshotId(owner.id, "note", card.noteId) : undefined,
      objectiveIds: card.objectiveIds?.map(objectiveId),
    })),
  };
}
/** Publishing/imported copies become independent and never follow private source/deck references. */
export function independentNoteLibrary(library: NoteLibrary): NoteLibrary {
  return {
    types: library.types.map((type) => ({
      ...type,
      templates: type.templates.map((template) => ({ ...template, deckAreaId: undefined })),
    })),
    notes: library.notes.map((note) => ({ ...note, source: undefined })),
  };
}

/** Removing a canonical owner leaves destination cards as independent local notes. */
export function detachDeletedNoteOwner(workspace: Workspace, deletedId: string): Workspace {
  return {
    ...workspace,
    areas: workspace.areas.map((area) => {
      if (!area.noteLibrary || area.id === deletedId) return area;
      const detached = new Set(
        area.noteLibrary.notes
          .filter((note) => note.source?.areaId === deletedId)
          .map((note) => note.id),
      );
      const detachedTypes = new Set(
        area.noteLibrary.notes.filter((note) => detached.has(note.id)).map((note) => note.typeId),
      );
      return {
        ...area,
        noteLibrary: {
          notes: area.noteLibrary.notes.map((note) =>
            detached.has(note.id) ? { ...note, source: undefined } : note,
          ),
          types: area.noteLibrary.types.map((type) => ({
            ...type,
            templates: type.templates.map((template) =>
              detachedTypes.has(type.id) || template.deckAreaId === deletedId
                ? { ...template, deckAreaId: undefined }
                : template,
            ),
          })),
        },
        cards: area.cards.map((card) =>
          card.noteId && detached.has(card.noteId)
            ? { ...card, siblingId: `note:${area.id}:${card.noteId}` }
            : card,
        ),
      };
    }),
  };
}

/** Detect partial sync and independently edited snapshots before a canonical edit overwrites them. */
export function noteOwnershipConflicts(workspace: Workspace, owner: LearningArea) {
  const canonicalNotes = new Map(
    (owner.noteLibrary?.notes ?? []).filter((note) => !note.source).map((note) => [note.id, note]),
  );
  const types = new Map((owner.noteLibrary?.types ?? []).map((type) => [type.id, type]));
  const objectiveId = (id: string) => createObjectiveId(snapshotId(owner.id, "objective", id));
  const expectedObjectives = new Map(
    (owner.objectives ?? []).map((objective) => {
      const mapped = {
        ...objective,
        id: objectiveId(objective.id),
        prerequisiteIds: objective.prerequisiteIds.map(objectiveId),
      };
      return [mapped.id, mapped] as const;
    }),
  );
  return workspace.areas.flatMap((area) => {
    const actualObjectives = new Map(
      (area.objectives ?? []).map((objective) => [objective.id, objective]),
    );
    const actualCards = new Map<string, Assessment[]>();
    for (const card of area.cards) {
      if (!card.noteId) continue;
      const existing = actualCards.get(card.noteId) ?? [];
      existing.push(card);
      actualCards.set(card.noteId, existing);
    }
    const actualTypes = new Map((area.noteLibrary?.types ?? []).map((type) => [type.id, type]));
    return (area.noteLibrary?.notes ?? [])
      .filter((note) => note.source?.areaId === owner.id)
      .flatMap((note) => {
        const source = note.source;
        const original = source ? canonicalNotes.get(source.noteId) : undefined;
        const originalType = original ? types.get(original.typeId) : undefined;
        if (!original || !originalType)
          return [{ areaId: area.id, areaTitle: area.title, noteId: note.id, fields: note.fields }];
        const expectedNote = {
          ...original,
          id: snapshotId(owner.id, "note", original.id),
          typeId: snapshotId(owner.id, "type", original.typeId),
          source: {
            areaId: owner.id,
            noteId: original.id,
            revision: digest({
              note: original,
              type: originalType,
              objectives: owner.objectives ?? [],
            }),
          },
          objectiveIds: original.objectiveIds.map(objectiveId),
        };
        const expectedType = { ...originalType, id: expectedNote.typeId };
        const actual = {
          note,
          type: actualTypes.get(note.typeId),
          objectives: note.objectiveIds.map((id) => actualObjectives.get(id)),
        };
        const expected = {
          note: expectedNote,
          type: expectedType,
          objectives: expectedNote.objectiveIds.map((id) => expectedObjectives.get(id)),
        };
        const rendered = Effect.runSync(Effect.either(previewStudyNote(originalType, original)));
        const previews =
          rendered._tag === "Right"
            ? new Map(rendered.right.map((card) => [noteCardKey(card), card]))
            : undefined;
        const changedCard = (actualCards.get(note.id) ?? []).find((card) => {
          const preview = previews?.get(noteCardKey(card));
          return (
            !preview ||
            digest({
              front: card.front,
              back: card.back,
              cloze: card.cloze,
              presentation: card.presentation,
              tags: card.tags ?? [],
              media: card.media ?? [],
            }) !==
              digest({
                front: preview.front,
                back: preview.back,
                cloze: preview.cloze,
                presentation: preview.presentation,
                tags: original.tags,
                media: original.media ?? [],
              })
          );
        });
        const fields = changedCard
          ? { ...note.fields, "Card question": changedCard.front, "Card answer": changedCard.back }
          : note.fields;
        return digest(actual) === digest(expected) && !changedCard
          ? []
          : [{ areaId: area.id, areaTitle: area.title, noteId: note.id, fields }];
      });
  });
}

export function collectionNoteOwnershipConflicts(workspace: Workspace) {
  const owners = new Set(
    workspace.areas.flatMap((area) =>
      (area.noteLibrary?.notes ?? []).flatMap((note) => (note.source ? [note.source.areaId] : [])),
    ),
  );
  return workspace.areas
    .filter((area) => owners.has(area.id))
    .flatMap((area) => noteOwnershipConflicts(workspace, area));
}
