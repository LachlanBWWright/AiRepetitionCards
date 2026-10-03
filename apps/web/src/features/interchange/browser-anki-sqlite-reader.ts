import initSqlJs, { type SqlJsStatic } from "sql.js";
import { Effect, Either } from "effect";
import {
  decodeAnkiV18Collection,
  type AnkiCollection,
  type AnkiSqliteReader,
  type AnkiSqliteReaderError,
  type AnkiV18CollectionRows,
} from "@recall/application";

const databaseLimit = 500;
const SQLITE_HEADER = "SQLite format 3\u0000";

type LegacyModel = {
  readonly id: number;
  readonly name: string;
  readonly type: number;
  readonly flds: readonly { readonly name: string }[];
};
type LegacyDeck = { readonly id: number; readonly name: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function parseObject(raw: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}
function decodeModels(raw: string): readonly LegacyModel[] | undefined {
  const parsed = parseObject(raw);
  if (!parsed) return undefined;
  const values: LegacyModel[] = [];
  for (const [key, rawModel] of Object.entries(parsed)) {
    const model = record(rawModel);
    const fields = model?.flds;
    if (
      !model ||
      !Array.isArray(fields) ||
      typeof model.name !== "string" ||
      typeof model.type !== "number" ||
      !/^\d+$/.test(key)
    )
      return undefined;
    const fieldNames = fields.flatMap((rawField) => {
      const field = record(rawField);
      return field && typeof field.name === "string" ? [field.name] : [];
    });
    if (fieldNames.length !== fields.length) return undefined;
    values.push({
      id: Number(key),
      name: model.name,
      type: model.type,
      flds: fieldNames.map((name) => ({ name })),
    });
  }
  return values;
}
function decodeDecks(raw: string): readonly LegacyDeck[] | undefined {
  const parsed = parseObject(raw);
  if (!parsed) return undefined;
  const values: LegacyDeck[] = [];
  for (const [key, rawDeck] of Object.entries(parsed)) {
    const deck = record(rawDeck);
    if (!deck || typeof deck.name !== "string" || !/^\d+$/.test(key)) return undefined;
    values.push({ id: Number(key), name: deck.name });
  }
  return values;
}
function values(
  database: InstanceType<SqlJsStatic["Database"]>,
  sql: string,
): readonly (readonly unknown[])[] {
  const [result] = database.exec(sql);
  return result?.values ?? [];
}

let sqlitePromise: Promise<SqlJsStatic> | undefined;
function loadSqlite(): Promise<SqlJsStatic> {
  sqlitePromise ??= initSqlJs({
    locateFile: (file) => (file.endsWith(".wasm") ? "/vendor/sql-wasm.wasm" : file),
  });
  return sqlitePromise;
}

function readCollection(
  Sqlite: SqlJsStatic,
  bytes: Uint8Array,
): Either.Either<AnkiCollection, AnkiSqliteReaderError> {
  const invalid = (reason: AnkiSqliteReaderError["reason"]) =>
    Either.left({ _tag: "AnkiSqliteReaderError", reason } as const);
  const database = new Sqlite.Database(bytes);
  try {
    const tables = new Set(
      values(database, "SELECT name FROM sqlite_master WHERE type = 'table'").flatMap((row) =>
        typeof row[0] === "string" ? [row[0]] : [],
      ),
    );
    const reviewsFromRevlog = (): Either.Either<
      readonly {
        readonly cardId: unknown;
        readonly reviewedAt: unknown;
        readonly ease: unknown;
        readonly type: unknown;
      }[],
      AnkiSqliteReaderError
    > => {
      if (!tables.has("revlog")) return Either.right([]);
      const rows = values(
        database,
        "SELECT id, cid, ease, type FROM revlog ORDER BY id LIMIT 10001",
      );
      if (rows.length > 10_000) return invalid("limits-exceeded");
      return Either.right(
        rows.map(([reviewedAt, cardId, ease, type]) => ({ cardId, reviewedAt, ease, type })),
      );
    };
    if (tables.has("notetypes") && tables.has("fields") && tables.has("decks")) {
      const noteTypes = values(database, "SELECT id, name, config FROM notetypes LIMIT 501").map(
        ([id, name, config]) => ({ id, name, config }),
      );
      const fields = values(database, "SELECT ntid, ord, name FROM fields LIMIT 50001").map(
        ([noteTypeId, ordinal, name]) => ({ noteTypeId, ordinal, name }),
      );
      const decks = values(database, "SELECT id, name FROM decks LIMIT 2001").map(([id, name]) => ({
        id,
        name,
      }));
      const notes = values(database, "SELECT id, guid, mid, flds, tags FROM notes LIMIT 501").map(
        ([id, guid, noteTypeId, fieldsValue, tags]) => ({
          id,
          guid,
          noteTypeId,
          fields: fieldsValue,
          tags,
        }),
      );
      const cards = values(
        database,
        "SELECT id, nid, ord, did FROM cards ORDER BY id LIMIT 501",
      ).map(([id, noteId, ordinal, deckId]) => ({ id, noteId, ordinal, deckId }));
      const reviews = reviewsFromRevlog();
      if (Either.isLeft(reviews)) return invalid(reviews.left.reason);
      return decodeAnkiV18Collection({
        noteTypes,
        fields,
        decks,
        notes,
        cards,
        reviews: reviews.right,
      } as AnkiV18CollectionRows);
    }
    const [collection] = values(database, "SELECT models, decks FROM col LIMIT 1");
    if (!collection || typeof collection[0] !== "string" || typeof collection[1] !== "string") {
      return invalid("unsupported-database");
    }
    const noteTypes = decodeModels(collection[0]);
    const decks = decodeDecks(collection[1]);
    if (!noteTypes || !decks) return invalid("invalid-database");

    const cardRows = values(
      database,
      "SELECT c.id, c.nid, c.ord, c.did, n.guid, n.mid, n.flds, n.tags " +
        "FROM cards c INNER JOIN notes n ON n.id = c.nid ORDER BY c.id LIMIT 501",
    );
    const reviews = reviewsFromRevlog();
    if (Either.isLeft(reviews)) return invalid(reviews.left.reason);
    if (cardRows.length > databaseLimit) return invalid("limits-exceeded");
    const modelById = new Map(noteTypes.map((model) => [model.id, model]));
    const deckById = new Map(decks.map((deck) => [deck.id, deck.name]));
    const notes = new Map<
      number,
      {
        id: number;
        guid: string;
        noteTypeId: number;
        fields: readonly string[];
        tags: readonly string[];
      }
    >();
    const cards: { id: number; noteId: number; ordinal: number }[] = [];
    const deckNames = new Set<string>();
    for (const row of cardRows) {
      const [rawCardId, rawNoteId, rawOrdinal, rawDeckId, rawGuid, rawModelId, rawFields, rawTags] =
        row;
      if (
        typeof rawCardId !== "number" ||
        typeof rawNoteId !== "number" ||
        typeof rawOrdinal !== "number" ||
        typeof rawDeckId !== "number" ||
        typeof rawGuid !== "string" ||
        typeof rawModelId !== "number" ||
        typeof rawFields !== "string" ||
        typeof rawTags !== "string"
      )
        return invalid("invalid-database");
      const model = modelById.get(rawModelId);
      if (!model) return invalid("invalid-database");
      const fields = rawFields.split("\u001f");
      if (fields.length !== model.flds.length) return invalid("invalid-database");
      if (!notes.has(rawNoteId)) {
        notes.set(rawNoteId, {
          id: rawNoteId,
          guid: rawGuid,
          noteTypeId: rawModelId,
          fields,
          tags: rawTags.trim().split(/\s+/).filter(Boolean),
        });
      }
      cards.push({ id: rawCardId, noteId: rawNoteId, ordinal: rawOrdinal });
      const deckName = deckById.get(rawDeckId);
      if (deckName) deckNames.add(deckName);
    }
    return Either.right({
      deckNames: [...deckNames],
      noteTypes: noteTypes.map((model) => ({
        id: model.id,
        name: model.name,
        kind:
          model.type === 0
            ? ("basic" as const)
            : model.type === 1
              ? ("cloze" as const)
              : ("unsupported" as const),
        fields: model.flds.map((field) => field.name),
      })),
      notes: [...notes.values()],
      cards,
      reviews: reviews.right.map((review) => ({
        cardId: review.cardId,
        reviewedAt: review.reviewedAt,
        ease: review.ease,
        type: review.type,
      })) as NonNullable<AnkiCollection["reviews"]>,
    });
  } finally {
    database.close();
  }
}

/** Browser-only adapter for legacy collection.anki2 databases; shared import remains platform-neutral. */
export const readAnkiSqliteInBrowser: AnkiSqliteReader = (bytes) => {
  if (new TextDecoder().decode(bytes.slice(0, SQLITE_HEADER.length)) !== SQLITE_HEADER) {
    return Effect.fail({ _tag: "AnkiSqliteReaderError", reason: "unsupported-database" });
  }
  return Effect.tryPromise({
    try: async () => readCollection(await loadSqlite(), bytes),
    catch: (): AnkiSqliteReaderError => ({
      _tag: "AnkiSqliteReaderError",
      reason: "invalid-database",
    }),
  }).pipe(Effect.flatMap(Either.match({ onLeft: Effect.fail, onRight: Effect.succeed })));
};
