import {
  collectNoteArea,
  noteCardLocations,
  placeNoteCards,
  noteOwnershipConflicts,
} from "./ownership";
import { Effect, Schema } from "effect";
import {
  AreaIdSchema,
  MAX_COLLECTION_CARDS,
  MAX_COLLECTION_NOTES,
  AssessmentIdSchema,
  NoteTypeSchema,
  StudyNoteSchema,
  WorkspaceSchema,
  type Assessment,
  type Workspace,
} from "@recall/domain";
import {
  indexNoteCards,
  NoteMigrationSchema,
  noteMigrationTargets,
  migratedOriginal,
  previewNoteMigration,
} from "./lifecycle";
import { newSchedule } from "@recall/scheduler";
import { captureCardVersion } from "../card-history";
import { deleteStudyCard } from "../authoring/card-management";
import { noteCardKey, noteFailure, previewStudyNote, type NoteAuthoringFailure } from "./preview";

export const SaveStudyNoteSchema = Schema.Struct({
  areaId: AreaIdSchema,
  note: StudyNoteSchema,
  type: Schema.optional(NoteTypeSchema),
  migration: Schema.optional(NoteMigrationSchema),
  cardIds: Schema.Array(
    Schema.Struct({
      noteId: Schema.optional(Schema.String),
      templateId: Schema.String,
      deletionIndex: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 20))),
      cardId: AssessmentIdSchema,
    }),
  ).pipe(Schema.maxItems(MAX_COLLECTION_CARDS)),
});
export type SaveStudyNote = typeof SaveStudyNoteSchema.Type;

/** Regenerate linked siblings atomically; schedule and review evidence retain their original identity. */
export function saveStudyNote(
  workspaceInput: unknown,
  commandInput: unknown,
  now: Date,
): Effect.Effect<Workspace, NoteAuthoringFailure> {
  return Effect.gen(function* () {
    const workspace = yield* Schema.decodeUnknown(WorkspaceSchema)(workspaceInput).pipe(
      Effect.mapError(() => noteFailure("This workspace contains invalid data.")),
    );
    const command = yield* Schema.decodeUnknown(SaveStudyNoteSchema)(commandInput).pipe(
      Effect.mapError(() => noteFailure("Check the note, type and card identities.")),
    );
    if (!Number.isFinite(now.getTime()))
      return yield* Effect.fail(noteFailure("The edit time is invalid."));
    const owner = workspace.areas.find((item) => item.id === command.areaId);
    const area = owner ? collectNoteArea(workspace, owner) : undefined;
    if (!area)
      return yield* Effect.fail(noteFailure("This subject no longer exists.", "area-missing"));
    const library = area.noteLibrary ?? { types: [], notes: [] };
    if (command.note.source || library.notes.find((note) => note.id === command.note.id)?.source)
      return yield* Effect.fail(noteFailure("Open the original shared note to edit linked cards."));
    if (
      noteOwnershipConflicts(workspace, owner ?? area).length &&
      !command.migration?.confirmLinkedSnapshots
    )
      return yield* Effect.fail(
        noteFailure(
          "A linked subject contains a stale or independently edited note snapshot. Review the conflicting fields before replacing it with this source note.",
        ),
      );
    const locations = noteCardLocations(workspace);
    const type = command.type ?? library.types.find((item) => item.id === command.note.typeId);
    if (!type || type.id !== command.note.typeId)
      return yield* Effect.fail(
        noteFailure("Choose an existing note type or supply its definition."),
      );
    const plan = yield* previewNoteMigration(area, type, command.note, command.migration);
    const previousType = library.types.find((item) => item.id === command.note.typeId);
    const structuralChange =
      command.migration !== undefined ||
      Boolean(
        previousType &&
        command.type &&
        JSON.stringify(previousType) !== JSON.stringify(command.type),
      );
    if (
      (plan.discardedValues.length > 0 || (structuralChange && plan.removed.length > 0)) &&
      !command.migration?.confirmRemoval
    )
      return yield* Effect.fail(
        noteFailure("Review and confirm the fields and cards that will be removed."),
      );
    const migratedNotes = noteMigrationTargets(area, type, command.note, command.migration);
    const migratedIds = new Set(migratedNotes.map((item) => item.id));
    const notes = [...library.notes.filter((note) => !migratedIds.has(note.id)), ...migratedNotes];
    const types = [...library.types.filter((item) => item.id !== type.id), type];
    if (notes.length > MAX_COLLECTION_NOTES || types.length > 100)
      return yield* Effect.fail(
        noteFailure(
          `A subject supports up to ${String(MAX_COLLECTION_NOTES)} shared notes and 100 note types.`,
        ),
      );
    const targets = command.type ? notes.filter((note) => note.typeId === type.id) : [command.note];
    const usedIds = new Set([
      ...workspace.areas.flatMap((item) => item.cards.map((card) => card.id)),
      ...(workspace.retainedReviewAreas ?? []).flatMap((item) => item.cards.map((card) => card.id)),
      ...(workspace.deletedCards ?? []).map((item) => item.cardId),
      ...(workspace.cardVersions ?? []).map((item) => item.cardId),
      ...(workspace.reviewEvents ?? []).map((item) => item.cardId),
    ]);
    let next = workspace;
    const generated: Assessment[] = [];
    const removed: Assessment[] = [];
    const byNote = indexNoteCards(area.cards);
    const suppliedIdentities = new Map(
      command.cardIds.map((item) => [
        JSON.stringify([item.noteId ?? command.note.id, noteCardKey(item)]),
        item,
      ]),
    );
    for (const note of targets) {
      const objectives = (area.objectives ?? []).filter((objective) =>
        note.objectiveIds.includes(objective.id),
      );
      if (objectives.length !== new Set(note.objectiveIds).size)
        return yield* Effect.fail(noteFailure("A selected learning objective no longer exists."));
      const previews = yield* previewStudyNote(type, note);
      const previous = byNote.get(note.id) ?? [];
      const migration = note.id === command.note.id ? command.migration : undefined;
      const retained = new Set(
        previews.map((preview) => migratedOriginal(previous, preview, migration)?.id),
      );
      removed.push(...previous.filter((card) => !retained.has(card.id)));
      for (const preview of previews) {
        const original = migratedOriginal(previous, preview, migration);
        const identity = suppliedIdentities.get(JSON.stringify([note.id, noteCardKey(preview)]));
        if (!original && (!identity || usedIds.has(identity.cardId)))
          return yield* Effect.fail(
            noteFailure(
              "Supply a fresh card identity for each newly generated sibling.",
              "identity-conflict",
            ),
          );
        const id = original?.id ?? identity?.cardId;
        if (!id) return yield* Effect.fail(noteFailure("A generated card identity is missing."));
        usedIds.add(id);
        const content = {
          id,
          noteId: note.id,
          templateId: preview.templateId,
          siblingId: `note:${area.id}:${note.id}`,
          presentation: preview.presentation,
          front: preview.front,
          back: preview.back,
          cloze: preview.cloze,
          tags: note.tags,
          media: note.media ?? [],
          objectiveIds: note.objectiveIds,
          objective:
            objectives.map((objective) => objective.title).join(" · ") || "My learning goals",
        };
        if (original && JSON.stringify({ ...original, ...content }) !== JSON.stringify(original))
          next = captureCardVersion(
            next,
            locations.get(original.id)?.area ?? area,
            locations.get(original.id)?.card ?? original,
            "edit",
            now,
          );
        generated.push({
          ...original,
          ...content,
          origin: original?.origin ?? "authored",
          schedule: original?.schedule ?? newSchedule(now),
        });
      }
    }
    const targetIds = new Set(targets.map((note) => note.id));
    for (const card of removed)
      next = yield* deleteStudyCard(
        next,
        { areaId: locations.get(card.id)?.area.id ?? area.id, cardId: card.id },
        now,
      ).pipe(Effect.mapError((error) => noteFailure(error.message)));
    const cards = [
      ...area.cards.filter((card) => !card.noteId || !targetIds.has(card.noteId)),
      ...generated,
    ];
    return yield* placeNoteCards(
      next,
      {
        ...area,
        noteLibrary: { types, notes },
        cards,
      },
      now,
    );
  });
}
