import { NoteMigrationSchema } from "./lifecycle";
import { Schema } from "effect";
import { AreaIdSchema, ReviewPresentationSchema, StudyNoteSchema } from "@recall/domain";

const draftText = Schema.String.pipe(Schema.maxLength(20_000));
// Editors can temporarily leave names/templates empty without losing their recoverable draft.
const draftType = Schema.Struct({
  id: draftText,
  name: draftText,
  fields: Schema.Array(
    Schema.Struct({ name: draftText, sticky: Schema.optional(Schema.Boolean) }),
  ).pipe(Schema.maxItems(50)),
  templates: Schema.Array(
    Schema.Struct({
      id: draftText,
      name: draftText,
      front: draftText,
      back: draftText,
      clozeField: Schema.optional(draftText),
      deckAreaId: Schema.optional(AreaIdSchema),
      presentation: Schema.optional(ReviewPresentationSchema),
    }),
  ).pipe(Schema.maxItems(20)),
});
export const NoteAuthoringDraftSchema = Schema.Struct({
  key: Schema.String.pipe(Schema.maxLength(400)),
  areaId: Schema.String.pipe(Schema.maxLength(200)),
  type: draftType,
  note: StudyNoteSchema,
  tagsText: Schema.String.pipe(Schema.maxLength(100_000)),
  baseline: Schema.optional(Schema.String),
  migration: Schema.optional(NoteMigrationSchema),
});
export type NoteAuthoringDraft = typeof NoteAuthoringDraftSchema.Type;
export const noteDraftKey = (areaId: string, noteId?: string) =>
  noteId ? `note:${areaId}:${noteId}` : `new-note:${areaId}`;

/** Uncommitted drafts retain attachment ownership just like saved cards. */
export function libraryDraftMediaReferences(
  notes: Pick<import("../authoring/library-notes").LibraryNotes, "drafts" | "noteDrafts">,
) {
  const references = [
    ...notes.drafts.flatMap((draft) => (draft.kind === "card" ? draft.media : [])),
    ...(notes.noteDrafts ?? []).flatMap((draft) => draft.note.media ?? []),
  ];
  return [...new Map(references.map((reference) => [reference.id, reference])).values()];
}
