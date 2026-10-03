import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Either } from "effect";
import type {
  AnkiCollection,
  AnkiNoteType,
  AnkiSqliteReader,
  AnkiSqliteReaderError,
  AnkiV18CollectionRows,
} from "@recall/application";
import { decodeAnkiV18Collection } from "@recall/application";

const maxDatabaseBytes = 80_000_000;
const maxRows = 500;
const sqliteHeader = new TextEncoder().encode("SQLite format 3\0");

type LegacyModel = {
  readonly id: number;
  readonly name: string;
  readonly kind: number;
  readonly fields: readonly string[];
};
type LegacyDeck = { readonly id: number; readonly name: string };
type SqlRow = Record<string, unknown>;

function failure(reason: AnkiSqliteReaderError["reason"]): AnkiSqliteReaderError {
  return { _tag: "AnkiSqliteReaderError", reason };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseLegacyObject(raw: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

function legacyModels(raw: string): readonly LegacyModel[] | undefined {
  const parsed = parseLegacyObject(raw);
  if (!parsed || Object.keys(parsed).length > maxRows) return undefined;
  const result: LegacyModel[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    const model = asRecord(value);
    if (
      !/^\d+$/.test(key) ||
      !model ||
      typeof model.name !== "string" ||
      typeof model.type !== "number" ||
      !Array.isArray(model.flds)
    )
      return undefined;
    const fields: string[] = [];
    for (const rawField of model.flds) {
      const field = asRecord(rawField);
      if (!field || typeof field.name !== "string") return undefined;
      fields.push(field.name);
    }
    result.push({ id: Number(key), name: model.name, kind: model.type, fields });
  }
  return result;
}

function legacyDecks(raw: string): readonly LegacyDeck[] | undefined {
  const parsed = parseLegacyObject(raw);
  if (!parsed || Object.keys(parsed).length > 2_000) return undefined;
  const result: LegacyDeck[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    const deck = asRecord(value);
    if (!/^\d+$/.test(key) || !deck || typeof deck.name !== "string") return undefined;
    result.push({ id: Number(key), name: deck.name });
  }
  return result;
}

function readRows(database: DatabaseSync, sql: string): readonly SqlRow[] {
  return database.prepare(sql).all() as readonly SqlRow[];
}

function readCollection(path: string): Either.Either<AnkiCollection, AnkiSqliteReaderError> {
  const opened = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => new DatabaseSync(path, { readOnly: true }),
        catch: () => failure("invalid-database"),
      }),
    ),
  );
  if (Either.isLeft(opened)) return Either.left(opened.left);
  const database = opened.right;
  try {
    database.exec("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;");
    const tables = new Set(
      readRows(
        database,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('col', 'notes', 'cards', 'notetypes', 'fields', 'decks', 'revlog')",
      ).flatMap((row) => (typeof row.name === "string" ? [row.name] : [])),
    );
    if (tables.has("notetypes") && tables.has("fields") && tables.has("decks")) {
      const noteTypes = readRows(database, "SELECT id, name, config FROM notetypes LIMIT 501");
      const fields = readRows(database, "SELECT ntid, ord, name FROM fields LIMIT 50001");
      const decks = readRows(database, "SELECT id, name FROM decks LIMIT 2001");
      const notes = readRows(database, "SELECT id, guid, mid, flds, tags FROM notes LIMIT 501");
      const cards = readRows(database, "SELECT id, nid, ord, did FROM cards ORDER BY id LIMIT 501");
      const reviews = tables.has("revlog")
        ? readRows(database, "SELECT id, cid, ease, type FROM revlog ORDER BY id LIMIT 10001")
        : [];
      if (reviews.length > 10_000) return Either.left(failure("limits-exceeded"));
      return decodeAnkiV18Collection({
        noteTypes: noteTypes.map((row) => ({ id: row.id, name: row.name, config: row.config })),
        fields: fields.map((row) => ({ noteTypeId: row.ntid, ordinal: row.ord, name: row.name })),
        decks: decks.map((row) => ({ id: row.id, name: row.name })),
        notes: notes.map((row) => ({
          id: row.id,
          guid: row.guid,
          noteTypeId: row.mid,
          fields: row.flds,
          tags: row.tags,
        })),
        cards: cards.map((row) => ({
          id: row.id,
          noteId: row.nid,
          ordinal: row.ord,
          deckId: row.did,
        })),
        reviews: reviews.map((row) => ({
          cardId: row.cid,
          reviewedAt: row.id,
          ease: row.ease,
          type: row.type,
        })),
      } as AnkiV18CollectionRows);
    }
    if (!["col", "notes", "cards"].every((name) => tables.has(name))) {
      return Either.left(failure("unsupported-database"));
    }
    const [collection] = readRows(database, "SELECT models, decks FROM col LIMIT 1");
    if (
      !collection ||
      typeof collection.models !== "string" ||
      typeof collection.decks !== "string"
    ) {
      return Either.left(failure("unsupported-database"));
    }
    if (collection.models.length > 10_000_000 || collection.decks.length > 10_000_000) {
      return Either.left(failure("limits-exceeded"));
    }
    const models = legacyModels(collection.models);
    const decks = legacyDecks(collection.decks);
    if (!models || !decks) return Either.left(failure("invalid-database"));

    const rows = readRows(
      database,
      "SELECT c.id AS card_id, c.nid AS note_id, c.ord AS ordinal, c.did AS deck_id, " +
        "n.guid AS guid, n.mid AS model_id, n.flds AS fields, n.tags AS tags " +
        "FROM cards c INNER JOIN notes n ON n.id = c.nid ORDER BY c.id LIMIT 501",
    );
    if (rows.length > maxRows) return Either.left(failure("limits-exceeded"));
    const reviewRows = tables.has("revlog")
      ? readRows(database, "SELECT id, cid, ease, type FROM revlog ORDER BY id LIMIT 10001")
      : [];
    if (reviewRows.length > 10_000) return Either.left(failure("limits-exceeded"));
    const reviews: NonNullable<AnkiCollection["reviews"]>[number][] = [];
    for (const review of reviewRows) {
      if (
        typeof review.id !== "number" ||
        typeof review.cid !== "number" ||
        typeof review.ease !== "number" ||
        typeof review.type !== "number"
      )
        return Either.left(failure("invalid-database"));
      reviews.push({
        cardId: review.cid,
        reviewedAt: review.id,
        ease: review.ease,
        type: review.type,
      });
    }
    const modelById = new Map(models.map((model) => [model.id, model]));
    const deckById = new Map(decks.map((deck) => [deck.id, deck.name]));
    const notes = new Map<number, AnkiCollection["notes"][number]>();
    const cards: AnkiCollection["cards"][number][] = [];
    const deckNames = new Set<string>();
    for (const row of rows) {
      const { card_id, note_id, ordinal, deck_id, guid, model_id, fields, tags } = row;
      if (
        typeof card_id !== "number" ||
        typeof note_id !== "number" ||
        typeof ordinal !== "number" ||
        typeof deck_id !== "number" ||
        typeof guid !== "string" ||
        typeof model_id !== "number" ||
        typeof fields !== "string" ||
        typeof tags !== "string"
      )
        return Either.left(failure("invalid-database"));
      const model = modelById.get(model_id);
      if (!model || fields.length > 500_000 || tags.length > 100_000)
        return Either.left(failure("invalid-database"));
      const splitFields = fields.split("\u001f");
      if (splitFields.length !== model.fields.length)
        return Either.left(failure("invalid-database"));
      if (!notes.has(note_id)) {
        notes.set(note_id, {
          id: note_id,
          guid,
          noteTypeId: model_id,
          fields: splitFields,
          tags: tags.trim().split(/\s+/).filter(Boolean),
        });
      }
      cards.push({ id: card_id, noteId: note_id, ordinal });
      const deckName = deckById.get(deck_id);
      if (deckName) deckNames.add(deckName);
    }
    const noteTypes: AnkiNoteType[] = models.map((model) => ({
      id: model.id,
      name: model.name,
      kind: model.kind === 0 ? "basic" : model.kind === 1 ? "cloze" : "unsupported",
      fields: model.fields,
    }));
    return Either.right({
      deckNames: [...deckNames],
      noteTypes,
      notes: [...notes.values()],
      cards,
      reviews,
    });
  } catch {
    return Either.left(failure("invalid-database"));
  } finally {
    database.close();
  }
}

/** Electron-only adapter for legacy collection.anki2 files. The database exists only in a private temporary directory. */
export const readAnkiSqliteInDesktop: AnkiSqliteReader = (input) => {
  if (!(input instanceof Uint8Array)) return Effect.fail(failure("invalid-database"));
  if (input.byteLength > maxDatabaseBytes) return Effect.fail(failure("limits-exceeded"));
  if (sqliteHeader.some((byte, index) => input[index] !== byte)) {
    return Effect.fail(failure("unsupported-database"));
  }
  return Effect.tryPromise({
    try: async () => {
      const directory = await mkdtemp(join(tmpdir(), "recall-anki-"));
      const path = join(directory, "collection.anki2");
      try {
        await writeFile(path, input, { flag: "wx", mode: 0o600 });
        return readCollection(path);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    catch: (): AnkiSqliteReaderError => failure("invalid-database"),
  }).pipe(Effect.flatMap(Either.match({ onLeft: Effect.fail, onRight: Effect.succeed })));
};
