import { Either } from "effect";
import type { AnkiCollection, AnkiSqliteReaderError } from "./anki-import";

export type AnkiV18CollectionRows = {
  readonly noteTypes: readonly {
    readonly id: unknown;
    readonly name: unknown;
    readonly config: unknown;
  }[];
  readonly fields: readonly {
    readonly noteTypeId: unknown;
    readonly ordinal: unknown;
    readonly name: unknown;
  }[];
  readonly decks: readonly { readonly id: unknown; readonly name: unknown }[];
  readonly notes: readonly {
    readonly id: unknown;
    readonly guid: unknown;
    readonly noteTypeId: unknown;
    readonly fields: unknown;
    readonly tags: unknown;
  }[];
  readonly cards: readonly {
    readonly id: unknown;
    readonly noteId: unknown;
    readonly ordinal: unknown;
    readonly deckId: unknown;
  }[];
  readonly reviews?: readonly {
    readonly cardId: unknown;
    readonly reviewedAt: unknown;
    readonly ease: unknown;
    readonly type: unknown;
  }[];
};

const fail = (reason: AnkiSqliteReaderError["reason"]) =>
  Either.left({ _tag: "AnkiSqliteReaderError", reason } as const);
const maxRows = 500;

function decodeNotetypeKind(input: unknown): "basic" | "cloze" | "unsupported" | undefined {
  if (!(input instanceof Uint8Array)) return undefined;
  let offset = 0;
  let kind: number | undefined;
  const readVarint = (): number | undefined => {
    let value = 0;
    let shift = 0;
    while (offset < input.length && shift < 35) {
      const byte = input[offset];
      if (byte === undefined) return undefined;
      offset += 1;
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value >>> 0;
      shift += 7;
    }
    return undefined;
  };
  while (offset < input.length) {
    const tag = readVarint();
    if (tag === undefined || tag === 0) return undefined;
    const fieldNumber = tag >>> 3;
    const wireType = tag & 7;
    if (wireType === 0) {
      const value = readVarint();
      if (value === undefined) return undefined;
      if (fieldNumber === 1) kind = value;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 2) {
      const size = readVarint();
      if (size === undefined || size > input.length - offset) return undefined;
      offset += size;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      return undefined;
    }
    if (offset > input.length) return undefined;
  }
  if (kind === 0 || kind === undefined) return "basic";
  if (kind === 1) return "cloze";
  return "unsupported";
}

/** Converts v18 normalized-table rows to the same validated application boundary as legacy Anki. */
export function decodeAnkiV18Collection(
  rows: AnkiV18CollectionRows,
): Either.Either<AnkiCollection, AnkiSqliteReaderError> {
  if (
    rows.noteTypes.length > maxRows ||
    rows.fields.length > 50_000 ||
    rows.decks.length > 2_000 ||
    rows.notes.length > maxRows ||
    rows.cards.length > maxRows ||
    (rows.reviews?.length ?? 0) > 10_000
  )
    return fail("limits-exceeded");

  const fieldsByType = new Map<number, { ordinal: number; name: string }[]>();
  for (const field of rows.fields) {
    const { noteTypeId, ordinal, name } = field;
    if (
      typeof noteTypeId !== "number" ||
      !Number.isInteger(noteTypeId) ||
      typeof ordinal !== "number" ||
      !Number.isInteger(ordinal) ||
      ordinal < 0 ||
      typeof name !== "string" ||
      name.length === 0 ||
      name.length > 200
    )
      return fail("invalid-database");
    const definitions = fieldsByType.get(noteTypeId) ?? [];
    if (definitions.some((entry) => entry.ordinal === ordinal)) return fail("invalid-database");
    definitions.push({ ordinal, name });
    fieldsByType.set(noteTypeId, definitions);
  }

  const noteTypes = [] as AnkiCollection["noteTypes"][number][];
  const noteTypeIds = new Set<number>();
  for (const row of rows.noteTypes) {
    if (
      typeof row.id !== "number" ||
      !Number.isInteger(row.id) ||
      typeof row.name !== "string" ||
      row.name.trim().length === 0 ||
      row.name.length > 200 ||
      noteTypeIds.has(row.id)
    )
      return fail("invalid-database");
    const fields = fieldsByType.get(row.id)?.sort((a, b) => a.ordinal - b.ordinal) ?? [];
    if (fields.length === 0 || fields.some((field, index) => field.ordinal !== index)) {
      return fail("invalid-database");
    }
    const kind = decodeNotetypeKind(row.config);
    if (kind === undefined) return fail("invalid-database");
    noteTypeIds.add(row.id);
    noteTypes.push({ id: row.id, name: row.name, kind, fields: fields.map((field) => field.name) });
  }

  const deckById = new Map<number, string>();
  for (const deck of rows.decks) {
    if (
      typeof deck.id !== "number" ||
      !Number.isInteger(deck.id) ||
      typeof deck.name !== "string" ||
      deck.name.length > 500
    )
      return fail("invalid-database");
    deckById.set(deck.id, deck.name);
  }
  const noteTypesById = new Map(noteTypes.map((noteType) => [noteType.id, noteType]));
  const notes = new Map<number, AnkiCollection["notes"][number]>();
  const cards: AnkiCollection["cards"][number][] = [];
  const deckNames = new Set<string>();
  for (const card of rows.cards) {
    if (
      typeof card.id !== "number" ||
      !Number.isInteger(card.id) ||
      typeof card.noteId !== "number" ||
      !Number.isInteger(card.noteId) ||
      typeof card.ordinal !== "number" ||
      !Number.isInteger(card.ordinal) ||
      card.ordinal < 0 ||
      typeof card.deckId !== "number" ||
      !Number.isInteger(card.deckId)
    )
      return fail("invalid-database");
    const note = rows.notes.find((candidate) => candidate.id === card.noteId);
    if (!note || typeof note.guid !== "string" || typeof note.noteTypeId !== "number") {
      return fail("invalid-database");
    }
    const noteType = noteTypesById.get(note.noteTypeId);
    if (!noteType || typeof note.fields !== "string" || typeof note.tags !== "string") {
      return fail("invalid-database");
    }
    const fields = note.fields.split("\u001f");
    if (
      fields.length !== noteType.fields.length ||
      fields.some((value) => value.length > 500_000)
    ) {
      return fail("invalid-database");
    }
    if (!notes.has(card.noteId)) {
      notes.set(card.noteId, {
        id: card.noteId,
        guid: note.guid,
        noteTypeId: note.noteTypeId,
        fields,
        tags: note.tags.trim().split(/\s+/).filter(Boolean),
      });
    }
    cards.push({ id: card.id, noteId: card.noteId, ordinal: card.ordinal });
    const deckName = deckById.get(card.deckId);
    if (deckName) deckNames.add(deckName);
  }
  const reviews: NonNullable<AnkiCollection["reviews"]>[number][] = [];
  for (const review of rows.reviews ?? []) {
    const { cardId, reviewedAt, ease, type } = review;
    if (
      typeof cardId !== "number" ||
      !Number.isSafeInteger(cardId) ||
      cardId < 0 ||
      typeof reviewedAt !== "number" ||
      !Number.isSafeInteger(reviewedAt) ||
      reviewedAt <= 0 ||
      typeof ease !== "number" ||
      !Number.isInteger(ease) ||
      ease < 0 ||
      ease > 4 ||
      typeof type !== "number" ||
      !Number.isInteger(type) ||
      type < 0 ||
      type > 4
    )
      return fail("invalid-database");
    reviews.push({ cardId, reviewedAt, ease, type });
  }
  return Either.right({
    deckNames: [...deckNames],
    noteTypes,
    notes: [...notes.values()],
    cards,
    reviews,
  });
}
