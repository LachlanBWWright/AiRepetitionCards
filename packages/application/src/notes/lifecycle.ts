import { Effect, Schema } from "effect";
import type { Assessment, LearningArea, NoteType, StudyNote } from "@recall/domain";
import { noteCardKey, noteFailure, previewStudyNote } from "./preview";

/** Maps destination names/identities to their source; an empty source creates a fresh value/card. */
export const NoteMigrationSchema = Schema.Struct({
  fields: Schema.Record({ key: Schema.String, value: Schema.String }),
  templates: Schema.Record({ key: Schema.String, value: Schema.String }),
  confirmRemoval: Schema.Boolean,
  confirmLinkedSnapshots: Schema.optional(Schema.Boolean),
});
export type NoteMigration = typeof NoteMigrationSchema.Type;
export function migrateNoteFields(
  note: StudyNote,
  type: NoteType,
  mapping: NoteMigration["fields"],
): StudyNote {
  return {
    ...note,
    typeId: type.id,
    fields: Object.fromEntries(
      type.fields.map((field) => [
        field.name,
        note.fields[mapping[field.name] ?? field.name] ?? "",
      ]),
    ),
  };
}
export function noteMigrationTargets(
  area: LearningArea,
  type: NoteType,
  note: StudyNote,
  migration?: NoteMigration,
) {
  const migrateOthers =
    migration &&
    area.noteLibrary?.notes.find((source) => source.id === note.id)?.typeId === type.id;
  return [
    ...(area.noteLibrary?.notes ?? [])
      .filter((item) => item.typeId === type.id && item.id !== note.id)
      .map((item) => (migrateOthers ? migrateNoteFields(item, type, migration.fields) : item)),
    note,
  ];
}
export function migratedOriginal(
  previous: readonly Assessment[],
  preview: Parameters<typeof noteCardKey>[0],
  migration?: NoteMigration,
) {
  const source = migration?.templates[preview.templateId ?? ""];
  return previous.find(
    (card) =>
      noteCardKey(card) === noteCardKey({ ...preview, templateId: source ?? preview.templateId }),
  );
}
export function previewNoteMigration(
  area: LearningArea,
  type: NoteType,
  note: StudyNote,
  migration?: NoteMigration,
) {
  return Effect.gen(function* () {
    const saved = area.noteLibrary?.notes.find((item) => item.id === note.id);
    const oldType = area.noteLibrary?.types.find((item) => item.id === saved?.typeId);
    if (saved && saved.typeId !== type.id && !migration)
      return yield* Effect.fail(
        noteFailure("Map the fields and cards before changing this note's type."),
      );
    if (migration) {
      const sourceFields = new Set(oldType?.fields.map((field) => field.name) ?? []);
      const sources = Object.values(migration.templates).filter(Boolean);
      if (
        new Set(sources).size !== sources.length ||
        Object.values(migration.fields).some((name) => name && !sourceFields.has(name))
      )
        return yield* Effect.fail(
          noteFailure("Choose valid source fields and map each old card template at most once."),
        );
      const allowedTemplates = new Set(oldType?.templates.map((template) => template.id) ?? []);
      if (sources.some((id) => !allowedTemplates.has(id)))
        return yield* Effect.fail(noteFailure("A mapped source card template no longer exists."));
    }
    const targets = noteMigrationTargets(area, type, note, migration);
    const byNote = indexNoteCards(area.cards);
    const removed: Assessment[] = [];
    let created = 0;
    for (const target of targets) {
      const cards = yield* previewStudyNote(type, target);
      const previous = byNote.get(target.id) ?? [];
      const retained = new Set(
        cards
          .map(
            (card) =>
              migratedOriginal(previous, card, target.id === note.id ? migration : undefined)?.id,
          )
          .filter(Boolean),
      );
      const matches = cards
        .map(
          (card) =>
            migratedOriginal(previous, card, target.id === note.id ? migration : undefined)?.id,
        )
        .filter(Boolean);
      if (matches.length !== new Set(matches).size)
        return yield* Effect.fail(
          noteFailure("Each existing card can preserve the schedule of only one destination card."),
        );
      removed.push(...previous.filter((card) => !retained.has(card.id)));
      created += cards.filter(
        (card) => !migratedOriginal(previous, card, target.id === note.id ? migration : undefined),
      ).length;
    }
    const affectedNotes =
      saved?.typeId === type.id
        ? (area.noteLibrary?.notes ?? []).filter((item) => item.typeId === type.id)
        : saved
          ? [saved]
          : [];
    const sourceNames = new Set(
      type.fields.map((field) => migration?.fields[field.name] ?? field.name),
    );
    const discardedValues = affectedNotes.flatMap((item) =>
      Object.entries(item.fields)
        .filter(([name, value]) => !sourceNames.has(name) && value.trim())
        .map(([field, value]) => ({ noteId: item.id, field, value })),
    );
    return {
      targets,
      removed,
      created,
      discardedValues,
      requiresConfirmation: removed.length > 0 || discardedValues.length > 0,
    };
  });
}

/** Build once per regeneration rather than scanning the collection for every note. */
export function indexNoteCards(cards: readonly Assessment[]) {
  const result = new Map<string, Assessment[]>();
  for (const card of cards) {
    if (!card.noteId) continue;
    const group = result.get(card.noteId);
    if (group) group.push(card);
    else result.set(card.noteId, [card]);
  }
  return result;
}
