import { Effect, Schema } from "effect";
import {
  NoteTypeSchema,
  StudyNoteSchema,
  type NoteType,
  type ReviewPresentation,
} from "@recall/domain";
import { expandCloze } from "../authoring/cloze";
import { renderNoteTemplate } from "./template-render";

export type NoteAuthoringFailure = {
  readonly _tag: "NoteAuthoringFailure";
  readonly reason: "invalid-input" | "area-missing" | "identity-conflict";
  readonly message: string;
};
export const noteFailure = (
  message: string,
  reason: NoteAuthoringFailure["reason"] = "invalid-input",
): NoteAuthoringFailure => ({ _tag: "NoteAuthoringFailure", reason, message });
export type NoteCardPreview = {
  readonly templateId: string;
  readonly presentation?: ReviewPresentation | undefined;
  readonly front: string;
  readonly back: string;
  readonly deletionIndex?: number | undefined;
  readonly cloze?: { readonly text: string; readonly deletionIndex: number };
};

/** Templates use text substitutions and conditional sections; HTML/scripts are never evaluated. */
export function previewStudyNote(
  typeInput: unknown,
  noteInput: unknown,
): Effect.Effect<readonly NoteCardPreview[], NoteAuthoringFailure> {
  return Effect.gen(function* () {
    const type = yield* Schema.decodeUnknown(NoteTypeSchema)(typeInput).pipe(
      Effect.mapError(() => noteFailure("Check the note type's fields and templates.")),
    );
    const note = yield* Schema.decodeUnknown(StudyNoteSchema)(noteInput).pipe(
      Effect.mapError(() => noteFailure("Check this note's fields, tags and attachments.")),
    );
    const allowed = new Set(type.fields.map((field) => field.name));
    if (type.id !== note.typeId || Object.keys(note.fields).some((name) => !allowed.has(name)))
      return yield* Effect.fail(noteFailure("The note's fields must belong to its selected type."));
    const cards: NoteCardPreview[] = [];
    for (const template of type.templates) {
      if (template.clozeField && !allowed.has(template.clozeField))
        return yield* Effect.fail(noteFailure("The cloze source field does not exist."));
      const clozes = template.clozeField
        ? yield* expandCloze(note.fields[template.clozeField]).pipe(
            Effect.mapError(() =>
              noteFailure("Use valid cloze deletions in the selected source field."),
            ),
          )
        : [undefined];
      for (const cloze of clozes) {
        const frontFields =
          cloze && template.clozeField
            ? { ...note.fields, [template.clozeField]: cloze.front }
            : note.fields;
        const backFields =
          cloze && template.clozeField
            ? { ...note.fields, [template.clozeField]: cloze.back }
            : note.fields;
        const front = renderNoteTemplate(template.front, frontFields, allowed);
        const back = renderNoteTemplate(template.back, backFields, allowed);
        if (front === undefined || back === undefined)
          return yield* Effect.fail(
            noteFailure(
              "Check template fields and matching {{#Field}}, {{^Field}} and {{/Field}} sections.",
            ),
          );
        if (front && back) {
          const clozeContent = cloze
            ? {
                deletionIndex: cloze.deletionIndex,
                cloze: { text: cloze.text, deletionIndex: cloze.deletionIndex },
              }
            : {};
          cards.push({
            presentation: template.presentation,
            templateId: template.id,
            front,
            back,
            ...clozeContent,
          });
        }
      }
    }
    if (!cards.length)
      return yield* Effect.fail(
        noteFailure("Fill the fields required to generate at least one complete card."),
      );
    return cards;
  });
}

export const BASIC_NOTE_TYPE: NoteType = {
  id: "basic",
  name: "Basic",
  fields: [{ name: "Front" }, { name: "Back" }],
  templates: [{ id: "forward", name: "Forward", front: "{{Front}}", back: "{{Back}}" }],
};
export const REVERSED_NOTE_TYPE: NoteType = {
  ...BASIC_NOTE_TYPE,
  id: "basic-reversed",
  name: "Basic and reversed",
  templates: [
    ...BASIC_NOTE_TYPE.templates,
    { id: "reverse", name: "Reverse", front: "{{Back}}", back: "{{Front}}" },
  ],
};
export const CLOZE_NOTE_TYPE: NoteType = {
  id: "cloze",
  name: "Cloze",
  fields: [{ name: "Text" }],
  templates: [
    { id: "cloze", name: "Cloze", front: "{{Text}}", back: "{{Text}}", clozeField: "Text" },
  ],
};
export const noteCardKey = (card: {
  readonly templateId?: string | undefined;
  readonly deletionIndex?: number | undefined;
  readonly cloze?: { readonly deletionIndex: number } | undefined;
}) => `${card.templateId ?? ""}:${String(card.deletionIndex ?? card.cloze?.deletionIndex ?? 0)}`;
