import { MAX_COLLECTION_NOTES } from "./collection-capacity";
import { ReviewPresentationSchema } from "./review-presentation";
import { Schema } from "effect";
import { AreaIdSchema, ObjectiveIdSchema } from "./ids";
import { MediaReferenceSchema } from "./media";

const Identifier = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200));
const FieldName = Schema.String.pipe(Schema.pattern(/^[A-Za-z][A-Za-z0-9 _-]{0,79}$/));
export const NoteTypeSchema = Schema.Struct({
  id: Identifier,
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  fields: Schema.Array(
    Schema.Struct({ name: FieldName, sticky: Schema.optional(Schema.Boolean) }),
  ).pipe(Schema.minItems(1), Schema.maxItems(50)),
  templates: Schema.Array(
    Schema.Struct({
      id: Identifier,
      name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
      front: Schema.String.pipe(Schema.maxLength(20_000)),
      back: Schema.String.pipe(Schema.maxLength(20_000)),
      clozeField: Schema.optional(FieldName),
      deckAreaId: Schema.optional(AreaIdSchema),
      presentation: Schema.optional(ReviewPresentationSchema),
    }),
  ).pipe(Schema.minItems(1), Schema.maxItems(20)),
}).pipe(
  Schema.filter(
    (type) =>
      new Set(type.fields.map((field) => field.name)).size === type.fields.length &&
      new Set(type.templates.map((template) => template.id)).size === type.templates.length,
  ),
);
export type NoteType = typeof NoteTypeSchema.Type;
export const StudyNoteSchema = Schema.Struct({
  id: Identifier,
  typeId: Identifier,
  source: Schema.optional(
    Schema.Struct({
      areaId: AreaIdSchema,
      noteId: Identifier,
      revision: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
    }),
  ),
  fields: Schema.Record({ key: FieldName, value: Schema.String.pipe(Schema.maxLength(20_000)) }),
  tags: Schema.Array(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80))).pipe(
    Schema.maxItems(100),
  ),
  objectiveIds: Schema.Array(ObjectiveIdSchema),
  media: Schema.optional(Schema.Array(MediaReferenceSchema).pipe(Schema.maxItems(20))),
});
export type StudyNote = typeof StudyNoteSchema.Type;
export const NoteLibrarySchema = Schema.Struct({
  types: Schema.Array(NoteTypeSchema).pipe(Schema.maxItems(100)),
  notes: Schema.Array(StudyNoteSchema).pipe(Schema.maxItems(MAX_COLLECTION_NOTES)),
}).pipe(
  Schema.filter(
    (library) =>
      new Set(library.types.map((type) => type.id)).size === library.types.length &&
      new Set(library.notes.map((note) => note.id)).size === library.notes.length &&
      library.notes.every((note) => library.types.some((type) => type.id === note.typeId)),
  ),
);
export type NoteLibrary = typeof NoteLibrarySchema.Type;
