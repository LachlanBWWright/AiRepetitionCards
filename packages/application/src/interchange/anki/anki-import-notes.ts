import { Either, Schema } from "effect";
import {
  NoteLibrarySchema,
  type LearningArea,
  type MediaReference,
  type ObjectiveId,
  type NoteLibrary,
  type NoteType,
} from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";
import type { AnkiCollection, AnkiNoteType } from "./anki-import-contracts";
import { sanitizeField } from "./anki-import-media";

function importedType(type: AnkiNoteType, media: ReadonlyMap<string, StoredMediaAsset>): NoteType {
  if (type.kind === "cloze") {
    const field = type.fields.find((name) => name.toLowerCase() === "text") ?? "Text";
    return {
      id: `anki-type:${String(type.id)}`,
      name: type.name,
      fields: type.fields.map((name) => ({ name })),
      templates: [
        {
          id: "cloze",
          name: "Cloze",
          front: `{{${field}}}`,
          back: `{{${field}}}`,
          clozeField: field,
        },
      ],
    };
  }
  const raw = type.templates ?? [
    { name: "Card 1", front: "{{Front}}", back: "{{Back}}" },
    { name: "Reverse", front: "{{Back}}", back: "{{Front}}" },
  ];
  const templates: NoteType["templates"][number][] = [];
  for (const [index, template] of raw.entries()) {
    const front = sanitizeField(template.front, media);
    const back = sanitizeField(template.back.replaceAll("{{FrontSide}}", template.front), media);
    if (front && front !== "invalid-media" && back && back !== "invalid-media")
      templates.push({
        id: String(index),
        name: template.name,
        front: front.text,
        back: back.text,
      });
  }
  return {
    id: `anki-type:${String(type.id)}`,
    name: type.name,
    fields: type.fields.map((name) => ({ name })),
    templates,
  };
}

/** Keep editable note sources when they fit Recall's safe text-template model. */
export function importedAnkiNotes(
  collection: AnkiCollection,
  cards: LearningArea["cards"],
  ids: ReadonlyMap<number, string>,
  objectiveId: ObjectiveId,
  mediaByName: ReadonlyMap<string, StoredMediaAsset>,
): { readonly cards: LearningArea["cards"]; readonly noteLibrary?: NoteLibrary } {
  const sourceTypes = new Map(collection.noteTypes.map((type) => [type.id, type]));
  const sourceNotes = new Map(collection.notes.map((note) => [note.id, note]));
  const sourceCards = new Map(collection.cards.map((card) => [ids.get(card.id), card]));
  const types = collection.noteTypes.map((type) => importedType(type, mediaByName));
  const notes = collection.notes.map((note) => {
    const type = sourceTypes.get(note.noteTypeId);
    const refs = new Map<string, MediaReference>();
    const fields = Object.fromEntries(
      (type?.fields ?? []).map((name, index) => {
        const sanitized = sanitizeField(note.fields[index] ?? "", mediaByName);
        if (sanitized && sanitized !== "invalid-media")
          for (const ref of sanitized.references) refs.set(ref.id, ref);
        return [name, sanitized && sanitized !== "invalid-media" ? sanitized.text : ""];
      }),
    );
    return {
      id: `anki-note:${note.guid}`,
      typeId: `anki-type:${String(note.noteTypeId)}`,
      fields,
      tags: note.tags,
      objectiveIds: [objectiveId],
      media: [...refs.values()],
    };
  });
  const decoded = Schema.decodeUnknownEither(NoteLibrarySchema)({ types, notes });
  if (Either.isLeft(decoded)) return { cards };
  const importedFields = new Map(notes.map((note) => [note.id, note.fields]));
  return {
    noteLibrary: decoded.right,
    cards: cards.map((card) => {
      const source = sourceCards.get(card.id);
      const note = source ? sourceNotes.get(source.noteId) : undefined;
      const type = note ? sourceTypes.get(note.noteTypeId) : undefined;
      if (!source || !note || !type || card.imageOcclusion) return card;
      const textField = type.fields.find((name) => name.toLowerCase() === "text");
      const text = importedFields.get(`anki-note:${note.guid}`)?.[textField ?? ""];
      return {
        ...card,
        noteId: `anki-note:${note.guid}`,
        templateId: type.kind === "cloze" ? "cloze" : String(source.ordinal),
        ...(type.kind === "cloze" && text
          ? { cloze: { text, deletionIndex: source.ordinal + 1 } }
          : {}),
      };
    }),
  };
}
