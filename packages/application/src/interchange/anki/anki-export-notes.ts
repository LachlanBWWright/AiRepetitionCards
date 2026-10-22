import type { MediaReference, LearningArea, NoteType } from "@recall/domain";
import { ankiMediaName } from "./anki-export";

export const ankiHtml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\n", "<br>");
function mediaHtml(references: readonly MediaReference[]): string {
  return references
    .map((ref) => {
      const name = ankiMediaName(ref.id, ref.mimeType);
      return ref.mimeType.startsWith("audio/") ? `[sound:${name}]` : `<img src="${name}">`;
    })
    .join("<br>");
}
function model(type: NoteType, id: number, deckId: number, seconds: number) {
  return {
    id,
    name: type.name,
    type: type.templates.some((template) => template.clozeField) ? 1 : 0,
    mod: seconds,
    usn: -1,
    sortf: 0,
    did: deckId,
    css: ".card { font-family: Arial; font-size: 20px; text-align: center; }",
    latexPre: "",
    latexPost: "",
    latexsvg: false,
    vers: [],
    tags: [],
    flds: type.fields.map((field, ord) => ({
      name: field.name,
      ord,
      sticky: field.sticky ?? false,
      rtl: false,
      font: "Arial",
      size: 20,
      media: [],
    })),
    tmpls: type.templates.map((template, ord) => ({
      name: template.name,
      ord,
      qfmt: template.clozeField ? `{{cloze:${template.clozeField}}}` : ankiHtml(template.front),
      afmt: template.clozeField ? `{{cloze:${template.clozeField}}}` : ankiHtml(template.back),
      bqfmt: "",
      bafmt: "",
      did: null,
    })),
    req: type.templates.map((template, ord) => [
      ord,
      "all",
      type.fields.flatMap((field, index) =>
        template.front.includes(`{{${field.name}}}`) ? [index] : [],
      ),
    ]),
  };
}
const basic: NoteType = {
  id: "fallback",
  name: "Recall Basic",
  fields: [{ name: "Front" }, { name: "Back" }],
  templates: [{ id: "basic", name: "Card 1", front: "{{Front}}", back: "{{Back}}" }],
};

export function buildAnkiExportNotes(area: LearningArea, deckId: number, seconds: number) {
  const types = [basic, ...(area.noteLibrary?.types ?? [])];
  const modelIds = new Map(types.map((type, index) => [type.id, deckId + 1 + index]));
  const models = Object.fromEntries(
    types.map((type) => {
      const id = modelIds.get(type.id) ?? deckId + 1;
      return [id, model(type, id, deckId, seconds)];
    }),
  );
  const notes = new Map<
    string,
    {
      readonly id: number;
      readonly modelId: number;
      readonly guid: string;
      readonly fields: string;
      readonly front: string;
      readonly tags: readonly string[];
    }
  >();
  const sourceNotes = new Map(area.noteLibrary?.notes.map((note) => [note.id, note]));
  const sourceTypes = new Map(types.map((type) => [type.id, type]));
  const cards = area.cards.map((card, index) => {
    const note = card.noteId ? sourceNotes.get(card.noteId) : undefined;
    const type = note ? sourceTypes.get(note.typeId) : undefined;
    const templateIndex =
      type?.templates.findIndex((template) => template.id === card.templateId) ?? -1;
    const linked = note && type && templateIndex >= 0;
    const key = linked ? note.id : `card:${card.id}`;
    const noteId = notes.get(key)?.id ?? deckId + 1000 + index;
    if (!notes.has(key)) {
      const fields = linked
        ? type.fields.map((field) => ankiHtml(note.fields[field.name] ?? "")).join("\u001f")
        : [ankiHtml(card.front), ankiHtml(card.back)].join("\u001f");
      notes.set(key, {
        id: noteId,
        guid: card.sourceId?.match(/^anki:(.*):\d+$/)?.[1] ?? `recall-${key}`,
        modelId: linked ? (modelIds.get(type.id) ?? deckId + 1) : deckId + 1,
        fields:
          fields +
          mediaHtml([
            ...new Map(
              [...(card.media ?? []), ...(linked ? (note.media ?? []) : [])].map((ref) => [
                ref.id,
                ref,
              ]),
            ).values(),
          ]),
        front: linked ? (note.fields[type.fields[0]?.name ?? ""] ?? card.front) : card.front,
        tags: linked ? note.tags : (card.tags ?? []),
      });
    }
    return {
      noteId,
      ordinal: linked ? (card.cloze ? card.cloze.deletionIndex - 1 : templateIndex) : 0,
    };
  });
  return { models, notes: [...notes.values()], cards };
}
