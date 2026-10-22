import {
  decodeAnkiTemplates,
  decodeAnkiScheduling,
  type AnkiCollection,
} from "@recall/application";
import { Effect, Either } from "effect";
import * as SQLite from "expo-sqlite";
import {
  decodeAnkiV18Collection,
  type AnkiSqliteReader,
  type AnkiSqliteReaderError,
} from "@recall/application";

const maxNotes = 50_000;
const maxCards = 50_000;
const maxNoteTypes = 500;
const maxDecks = 500;

type NoteTypeRecord = {
  readonly id: number;
  readonly name: string;
  readonly kind: "basic" | "cloze" | "unsupported";
  readonly fields: readonly string[];
  readonly templates?: ReturnType<typeof decodeAnkiTemplates>;
};
type Decode<T> =
  | { readonly _tag: "Success"; readonly value: T }
  | { readonly _tag: "Failure"; readonly reason: AnkiSqliteReaderError["reason"] };
type AnkiCollectionData = AnkiCollection;

function readerError(reason: AnkiSqliteReaderError["reason"]): AnkiSqliteReaderError {
  return { _tag: "AnkiSqliteReaderError", reason };
}

function failure<T>(reason: AnkiSqliteReaderError["reason"]): Decode<T> {
  return { _tag: "Failure", reason };
}

function parseJsonObject(input: unknown): Decode<Record<string, unknown>> {
  if (typeof input !== "string") return failure("invalid-database");
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch {
    return failure("invalid-database");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return failure("invalid-database");
  }
  return { _tag: "Success", value: parsed as Record<string, unknown> };
}

function readNoteTypes(input: unknown): Decode<readonly NoteTypeRecord[]> {
  const decoded = parseJsonObject(input);
  if (decoded._tag === "Failure") return decoded;
  const entries = Object.entries(decoded.value);
  if (entries.length > maxNoteTypes) return failure("limits-exceeded");
  const noteTypes: NoteTypeRecord[] = [];
  for (const [key, raw] of entries) {
    if (!/^\d+$/.test(key) || typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return failure("invalid-database");
    }
    const model = raw as Record<string, unknown>;
    if (typeof model.name !== "string" || !Array.isArray(model.flds)) {
      return failure("invalid-database");
    }
    const fields: string[] = [];
    for (const field of model.flds) {
      if (typeof field !== "object" || field === null || Array.isArray(field)) {
        return failure("invalid-database");
      }
      const name = (field as Record<string, unknown>).name;
      if (typeof name !== "string") return failure("invalid-database");
      fields.push(name);
    }
    const kind = model.type === 1 ? "cloze" : model.type === 0 ? "basic" : "unsupported";
    noteTypes.push({
      id: Number(key),
      name: model.name,
      kind,
      fields,
      templates: decodeAnkiTemplates(model.tmpls),
    });
  }
  return { _tag: "Success", value: noteTypes };
}

function readDeckNames(input: unknown): Decode<readonly string[]> {
  const decoded = parseJsonObject(input);
  if (decoded._tag === "Failure") return decoded;
  const entries = Object.values(decoded.value);
  if (entries.length > maxDecks) return failure("limits-exceeded");
  const names: string[] = [];
  for (const raw of entries) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return failure("invalid-database");
    }
    const name = (raw as Record<string, unknown>).name;
    if (typeof name !== "string") return failure("invalid-database");
    names.push(name);
  }
  return { _tag: "Success", value: names };
}

/**
 * Reads legacy Anki collection.anki2 bytes in an isolated in-memory SQLite database.
 * The connection is query-only, bounded, and closed before this Effect completes.
 */
export const readAnkiSqliteDatabase: AnkiSqliteReader = (databaseBytes) =>
  Effect.tryPromise({
    try: async (): Promise<Decode<AnkiCollectionData>> => {
      let database: SQLite.SQLiteDatabase | undefined;
      try {
        database = await SQLite.deserializeDatabaseAsync(databaseBytes, { useNewConnection: true });
        await database.execAsync("PRAGMA query_only = ON;");

        const tables = await database.getAllAsync<{ readonly name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table'",
        );
        const tableNames = new Set(tables.map((table) => table.name));
        const readReviews = async () => {
          if (!tableNames.has("revlog")) return [] as const;
          const rows = await database?.getAllAsync<{
            readonly id: number;
            readonly cid: number;
            readonly time: number;
            readonly ease: number;
            readonly type: number;
          }>("SELECT id, cid, ease, type, time FROM revlog ORDER BY id LIMIT 250001");
          if (!rows || rows.length > 250_000) return null;
          return rows.map((row) => ({
            cardId: row.cid,
            reviewedAt: row.id,
            ease: row.ease,
            type: row.type,
            elapsedMs: row.time,
          }));
        };
        if (tableNames.has("notetypes") && tableNames.has("fields") && tableNames.has("decks")) {
          const noteTypes = await database.getAllAsync<{
            readonly id: number;
            readonly name: string;
            readonly config: Uint8Array;
          }>("SELECT id, name, config FROM notetypes LIMIT 501");
          const fields = await database.getAllAsync<{
            readonly ntid: number;
            readonly ord: number;
            readonly name: string;
          }>("SELECT ntid, ord, name FROM fields LIMIT 50001");
          const decks = await database.getAllAsync<{
            readonly id: number;
            readonly name: string;
          }>("SELECT id, name FROM decks LIMIT 2001");
          const notes = await database.getAllAsync<{
            readonly id: number;
            readonly guid: string;
            readonly mid: number;
            readonly flds: string;
            readonly tags: string;
          }>("SELECT id, guid, mid, flds, tags FROM notes LIMIT 50001");
          const cards = await database.getAllAsync<{
            readonly id: number;
            readonly nid: number;
            readonly ord: number;
            readonly did: number;
            readonly due: unknown;
            readonly ivl: unknown;
            readonly reps: unknown;
            readonly lapses: unknown;
            readonly type: unknown;
            readonly queue: unknown;
            readonly data: unknown;
            readonly odid: unknown;
          }>(
            "SELECT id, nid, ord, did, due, ivl, reps, lapses, type, queue, data, odid FROM cards ORDER BY id LIMIT 50001",
          );
          const created = tableNames.has("col")
            ? await database.getFirstAsync<{ readonly crt: unknown }>("SELECT crt FROM col LIMIT 1")
            : undefined;
          const reviews = await readReviews();
          if (reviews === null) return failure("limits-exceeded");
          const templates = tableNames.has("templates")
            ? await database.getAllAsync<{
                readonly ntid: unknown;
                readonly ord: unknown;
                readonly name: unknown;
                readonly config: unknown;
              }>("SELECT ntid, ord, name, config FROM templates LIMIT 50001")
            : [];
          const decoded = decodeAnkiV18Collection({
            templates: templates.map((row) => ({
              noteTypeId: row.ntid,
              ordinal: row.ord,
              name: row.name,
              config: row.config,
            })),
            noteTypes: noteTypes.map((row) => ({ id: row.id, name: row.name, config: row.config })),
            fields: fields.map((row) => ({
              noteTypeId: row.ntid,
              ordinal: row.ord,
              name: row.name,
            })),
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
              scheduling: decodeAnkiScheduling(row, created?.crt),
            })),
            reviews,
          });
          return Either.match(decoded, {
            onLeft: (error) => failure(error.reason),
            onRight: (value) => ({ _tag: "Success", value }),
          });
        }
        if (!["col", "notes", "cards"].every((name) => tableNames.has(name))) {
          return failure("unsupported-database");
        }

        // LIMIT + 1 detects truncation before handing data to the shared schema validator.
        const noteRows = await database.getAllAsync<{
          readonly id: number;
          readonly guid: string;
          readonly mid: number;
          readonly flds: string;
          readonly tags: string;
        }>("SELECT id, guid, mid, flds, tags FROM notes LIMIT ?", maxNotes + 1);
        const cardRows = await database.getAllAsync<{
          readonly id: number;
          readonly nid: number;
          readonly ord: number;
          readonly due: number;
          readonly ivl: number;
          readonly reps: number;
          readonly lapses: number;
          readonly type: number;
          readonly queue: number;
          readonly data: unknown;
          readonly odid: unknown;
        }>(
          "SELECT id, nid, ord, due, ivl, reps, lapses, type, queue, data, odid FROM cards LIMIT ?",
          maxCards + 1,
        );
        const reviews = await readReviews();
        if (reviews === null) return failure("limits-exceeded");
        if (noteRows.length > maxNotes || cardRows.length > maxCards) {
          return failure("limits-exceeded");
        }

        const collection = await database.getFirstAsync<{
          readonly models: string;
          readonly decks: string;
          readonly crt: number;
        }>("SELECT models, decks, crt FROM col LIMIT 1");
        if (!collection) return failure("unsupported-database");
        const noteTypes = readNoteTypes(collection.models);
        if (noteTypes._tag === "Failure") return noteTypes;
        const deckNames = readDeckNames(collection.decks);
        if (deckNames._tag === "Failure") return deckNames;
        return {
          _tag: "Success",
          value: {
            deckNames: deckNames.value,
            noteTypes: noteTypes.value,
            notes: noteRows.map((note) => ({
              id: note.id,
              guid: note.guid,
              noteTypeId: note.mid,
              fields: note.flds.split("\u001f"),
              tags: note.tags.trim().split(/\s+/).filter(Boolean),
            })),
            cards: cardRows.map((card) => ({
              id: card.id,
              noteId: card.nid,
              ordinal: card.ord,
              scheduling: decodeAnkiScheduling(card, collection.crt),
            })),
            reviews,
          },
        };
      } finally {
        await database?.closeAsync();
      }
    },
    catch: () => readerError("invalid-database"),
  }).pipe(
    Effect.flatMap((decoded) =>
      decoded._tag === "Failure"
        ? Effect.fail(readerError(decoded.reason))
        : Effect.succeed(decoded.value),
    ),
  );
