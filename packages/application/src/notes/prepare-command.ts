import { Effect, Schema } from "effect";
import type { LearningArea, NoteType, StudyNote } from "@recall/domain";
import { previewStudyNote } from "./preview";
import {
  indexNoteCards,
  migratedOriginal,
  noteMigrationTargets,
  type NoteMigration,
} from "./lifecycle";
import { WorkspaceAuthoringCommandSchema } from "../authoring/workspace-authoring-command";

/** A type edit can add siblings to every note using that type, not just the open note. */
export function prepareNoteSave(
  area: LearningArea,
  type: NoteType,
  note: StudyNote,
  createId: () => string,
  migration?: NoteMigration,
) {
  return Effect.gen(function* () {
    const targets = noteMigrationTargets(area, type, note, migration);
    const identities: {
      readonly noteId: string;
      readonly templateId: string;
      readonly deletionIndex?: number;
      readonly cardId: string;
    }[] = [];
    const byNote = indexNoteCards(area.cards);
    for (const target of targets) {
      const previews = yield* previewStudyNote(type, target);
      for (const preview of previews) {
        const existing = migratedOriginal(
          byNote.get(target.id) ?? [],
          preview,
          target.id === note.id ? migration : undefined,
        );
        if (!existing)
          identities.push({
            noteId: target.id,
            templateId: preview.templateId,
            ...(preview.deletionIndex ? { deletionIndex: preview.deletionIndex } : {}),
            cardId: createId(),
          });
      }
    }
    return yield* Schema.decodeUnknown(WorkspaceAuthoringCommandSchema)({
      kind: "save-note",
      areaId: area.id,
      note,
      type,
      ...(migration ? { migration } : {}),
      cardIds: identities,
    }).pipe(Effect.mapError(() => ({ message: "The note or generated identities are invalid." })));
  });
}
