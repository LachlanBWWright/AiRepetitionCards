import { sha256 } from "@noble/hashes/sha2.js";
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Schema } from "effect";
import { unzipSync } from "fflate";
import {
  createAreaId,
  createAssessmentId,
  createReviewEventId,
  MediaIdSchema,
  type LearningArea,
} from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import {
  AnkiCollectionSchema,
  toKnowledgeArea,
  exportKnowledgeAreaPackage,
  importKnowledgeAreaPackage,
  exportPortableDeckPackage,
  importPortableDeckPackage,
  exportAnkiApkg,
  importAnkiApkg,
  decodeAnkiScheduling,
  type AnkiSqliteWriter,
  type AnkiExportFailure,
} from "@recall/application";
import { readAnkiSqliteInDesktop } from "../../../../apps/desktop/src/main/ipc/anki-sqlite-reader";
const now = new Date("2026-10-20T12:00:00Z");
const area: LearningArea = {
  id: createAreaId("test-area"),
  title: "Language",
  color: "#123456",
  cards: [
    {
      id: createAssessmentId("first"),
      front: "cat",
      back: "chat",
      objective: "Vocabulary",
      schedule: {
        ...newSchedule(now),
        state: 2,
        reps: 12,
        lapses: 2,
        scheduled_days: 14,
        due: "2026-11-03T00:00:00.000Z",
      },
      noteId: "note",
      templateId: "forward",
    },
    {
      id: createAssessmentId("second"),
      front: "chat",
      back: "cat",
      objective: "Vocabulary",
      schedule: newSchedule(now),
      noteId: "note",
      templateId: "reverse",
    },
  ],
  noteLibrary: {
    types: [
      {
        id: "words",
        name: "Vocabulary",
        fields: [{ name: "English" }, { name: "French" }],
        templates: [
          { id: "forward", name: "Forward", front: "{{English}}", back: "{{French}}" },
          { id: "reverse", name: "Reverse", front: "{{French}}", back: "{{English}}" },
        ],
      },
    ],
    notes: [
      {
        id: "note",
        typeId: "words",
        fields: { English: "cat", French: "chat" },
        tags: ["language"],
        objectiveIds: [],
      },
    ],
  },
};
const mediaStore = {
  get: () => Effect.succeed(null),
  put: () => Effect.void,
  delete: () => Effect.void,
  list: Effect.succeed([]),
};
const writer: AnkiSqliteWriter = (statements) =>
  Effect.tryPromise({
    try: async () => {
      const directory = await mkdtemp(join(tmpdir(), "recall-anki-export-"));
      const path = join(directory, "collection.anki2");
      try {
        const database = new DatabaseSync(path);
        try {
          for (const statement of statements) {
            if (statement.parameters.length === 0) database.exec(statement.sql);
            else database.prepare(statement.sql).run(...statement.parameters);
          }
        } finally {
          database.close();
        }
        return new Uint8Array(await readFile(path));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    catch: (): AnkiExportFailure => ({ _tag: "AnkiExportFailure", reason: "database-failed" }),
  });

await test("real Anki SQLite packages round-trip custom notes, reversed templates, and opt-in schedules", async () => {
  const bytes = await Effect.runPromise(
    exportAnkiApkg(area, mediaStore, writer, { now, includeScheduling: true }),
  );
  const files = unzipSync(bytes);
  assert.ok(files["collection.anki2"]);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(files.media)), {});
  const directory = await mkdtemp(join(tmpdir(), "recall-anki-inspect-"));
  try {
    const path = join(directory, "collection.anki2");
    await writeFile(path, files["collection.anki2"]);
    const database = new DatabaseSync(path);
    try {
      assert.equal(database.prepare("SELECT count(*) AS count FROM notes").get()?.count, 1);
      assert.equal(database.prepare("SELECT count(*) AS count FROM cards").get()?.count, 2);
      assert.equal(database.prepare("SELECT count(*) AS count FROM revlog").get()?.count, 0);
    } finally {
      database.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  let id = 0;
  const imported = await Effect.runPromise(
    importAnkiApkg(
      bytes,
      { now, color: "#123456", createId: () => `id-${String(++id)}` },
      readAnkiSqliteInDesktop,
    ),
  );
  assert.equal(imported.area.cards.length, 2);
  assert.equal(imported.area.cards.at(0)?.front, "cat");
  assert.equal(imported.area.cards.at(1)?.front, "chat");
  assert.equal(imported.area.noteLibrary?.notes.length, 1);
  assert.equal(imported.area.cards.at(0)?.schedule.due, "2026-11-03T00:00:00.000Z");
  assert.equal(imported.area.cards.at(0)?.schedule.scheduled_days, 14);
  assert.deepEqual(imported.area.cards.at(0)?.importedSchedule?.reviewEventIds, []);
});

await test("public Anki export resets learner state and never fabricates review history", async () => {
  const bytes = await Effect.runPromise(exportAnkiApkg(area, mediaStore, writer, { now }));
  const imported = await Effect.runPromise(
    importAnkiApkg(bytes, { now, color: "#123456" }, readAnkiSqliteInDesktop),
  );
  assert.equal(imported.area.cards.at(0)?.schedule.reps, 0);
  assert.equal(imported.area.cards.at(0)?.schedule.state, 0);
  assert.equal(imported.reviewEvents.length, 0);
});

await test("legacy scheduling conversion retains suspension and timestamp learning", () => {
  assert.equal(
    decodeAnkiScheduling({ due: 1, ivl: 2, reps: 3, lapses: 0, type: 2, queue: -1 }, 0)?.suspended,
    true,
  );
  const schedule = decodeAnkiScheduling(
    { due: now.getTime() / 1000, ivl: 0, reps: 3, lapses: 0, type: 1, queue: 1 },
    0,
  );
  assert.ok(schedule);
  assert.equal(schedule.due, now.toISOString());
  assert.equal(schedule.state, 1);
});

await test("invalid external export input fails before SQLite creation", async () => {
  const result = await Effect.runPromise(
    Effect.either(
      exportAnkiApkg(
        { cards: [] },
        mediaStore,
        () => {
          assert.fail("writer should not run");
        },
        { now },
      ),
    ),
  );
  assert.ok(Either.isLeft(result));
});

await test("normalized v18 reads static template protobuf and preserves supported schedules", async () => {
  const normalizedWriter: AnkiSqliteWriter = (statements) =>
    writer([
      ...statements,
      {
        sql: `
 CREATE TABLE notetypes (id integer, name text, config blob);
 CREATE TABLE fields (ntid integer, ord integer, name text);
 CREATE TABLE decks (id integer, name text);
 CREATE TABLE templates (ntid integer, ord integer, name text, config blob);
 INSERT INTO notetypes SELECT distinct mid, 'Vocabulary', x'' FROM notes;
 INSERT INTO fields SELECT distinct mid, 0, 'English' FROM notes;
 INSERT INTO fields SELECT distinct mid, 1, 'French' FROM notes;
 INSERT INTO decks SELECT distinct did, 'Language' FROM cards;
 INSERT INTO templates SELECT distinct mid, 0, 'Forward', x'0a0b7b7b456e676c6973687d7d120a7b7b4672656e63687d7d' FROM notes;
 INSERT INTO templates SELECT distinct mid, 1, 'Reverse', x'0a0a7b7b4672656e63687d7d120b7b7b456e676c6973687d7d' FROM notes;
 `,
        parameters: [],
      },
    ]);
  const bytes = await Effect.runPromise(
    exportAnkiApkg(area, mediaStore, normalizedWriter, { now, includeScheduling: true }),
  );
  const imported = await Effect.runPromise(
    importAnkiApkg(bytes, { now, color: "#123456" }, readAnkiSqliteInDesktop),
  );
  assert.equal(imported.area.cards.at(0)?.front, "cat");
  assert.equal(imported.area.cards.at(1)?.front, "chat");
  assert.equal(imported.area.cards.at(0)?.schedule.scheduled_days, 14);
  assert.equal(imported.area.noteLibrary?.notes.length, 1);
});

await test("preserved schedules keep real imported review evidence without replaying it", async () => {
  const withHistory: AnkiSqliteWriter = (statements) =>
    writer([
      ...statements,
      {
        sql: `INSERT INTO revlog SELECT 1792400000000, id, -1, 3, 14, 7, 2500, 1000, 1 FROM cards WHERE ord=0;`,
        parameters: [],
      },
    ]);
  const bytes = await Effect.runPromise(
    exportAnkiApkg(area, mediaStore, withHistory, { now, includeScheduling: true }),
  );
  const imported = await Effect.runPromise(
    importAnkiApkg(bytes, { now, color: "#123456" }, readAnkiSqliteInDesktop),
  );
  assert.equal(imported.reviewEvents.length, 1);
  assert.equal(imported.area.cards.at(0)?.schedule.scheduled_days, 14);
  assert.equal(imported.area.cards.at(0)?.schedule.reps, 12);
  assert.deepEqual(imported.area.cards.at(0)?.importedSchedule?.reviewEventIds, [
    imported.reviewEvents.at(0)?.id,
  ]);
  assert.equal(
    imported.area.cards.at(0)?.schedule.last_review,
    new Date(1792400000000).toISOString(),
  );
});

await test("custom template code and unknown conditionals fail before approval", async () => {
  const bytes = await Effect.runPromise(exportAnkiApkg(area, mediaStore, writer, { now }));
  const collection = await Effect.runPromise(
    readAnkiSqliteInDesktop(unzipSync(bytes)["collection.anki2"] ?? new Uint8Array()),
  );
  const decoded = Schema.decodeUnknownEither(AnkiCollectionSchema)(collection);
  assert.ok(Either.isRight(decoded));
  for (const front of [
    "<script>alert(1)</script>{{English}}",
    "{{#Unknown}}{{English}}{{/Unknown}}",
  ]) {
    const unsafe: unknown = {
      ...decoded.right,
      noteTypes: decoded.right.noteTypes.map((type) => ({
        ...type,
        templates: [
          { name: "Unsafe", front, back: "{{French}}" },
          { name: "Reverse", front: "{{French}}", back: "{{English}}" },
        ],
      })),
    };
    const result = await Effect.runPromise(
      Effect.either(importAnkiApkg(bytes, { now, color: "#123456" }, () => Effect.succeed(unsafe))),
    );
    assert.ok(Either.isLeft(result));
    assert.equal(result.left.reason, "unsupported-note-type");
  }
});

await test("note-only attachments survive canonical, portable and Anki packages", async () => {
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const decodedId = Schema.decodeUnknownEither(MediaIdSchema)(
    [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
  assert.ok(Either.isRight(decodedId));
  const id = decodedId.right;
  const reference = { id, mimeType: "image/png" as const, byteLength: bytes.length };
  const asset = { reference, bytes };
  const store = { ...mediaStore, get: () => Effect.succeed(asset) };
  const library = area.noteLibrary;
  assert.ok(library);
  const withMedia = {
    ...area,
    noteLibrary: {
      ...library,
      notes: library.notes.map((note) => ({ ...note, media: [reference] })),
    },
  };
  const blocked = await Effect.runPromise(Effect.either(toKnowledgeArea(withMedia, true, false)));
  assert.ok(Either.isLeft(blocked));
  const document = await Effect.runPromise(toKnowledgeArea(withMedia, true, true));
  const canonical = await Effect.runPromise(exportKnowledgeAreaPackage(document, store));
  const canonicalImport = await Effect.runPromise(importKnowledgeAreaPackage(canonical));
  assert.equal(canonicalImport.media.at(0)?.reference.id, id);
  const portable = await Effect.runPromise(exportPortableDeckPackage(document, store));
  const portableImport = await Effect.runPromise(importPortableDeckPackage(portable));
  assert.equal(portableImport.media.at(0)?.reference.id, id);
  const apkg = await Effect.runPromise(exportAnkiApkg(withMedia, store, writer, { now }));
  const ankiImport = await Effect.runPromise(
    importAnkiApkg(apkg, { now, color: "#123456" }, readAnkiSqliteInDesktop),
  );
  assert.equal(ankiImport.media.at(0)?.reference.id, id);
  assert.equal(ankiImport.area.noteLibrary?.notes.at(0)?.media?.at(0)?.id, id);
});

await test("Anki reset-to-new remains new even when genuine older review logs exist", async () => {
  const withHistory: AnkiSqliteWriter = (statements) =>
    writer([
      ...statements,
      {
        sql: "INSERT INTO revlog SELECT 1792400000000, id, -1, 3, 14, 7, 2500, 1000, 1 FROM cards WHERE ord=0;",
        parameters: [],
      },
    ]);
  const bytes = await Effect.runPromise(exportAnkiApkg(area, mediaStore, withHistory, { now }));
  const imported = await Effect.runPromise(
    importAnkiApkg(bytes, { now, color: "#123456" }, readAnkiSqliteInDesktop),
  );
  assert.equal(imported.reviewEvents.length, 1);
  assert.equal(imported.area.cards.at(0)?.schedule.state, 0);
  assert.equal(imported.area.cards.at(0)?.schedule.reps, 0);
  assert.equal(imported.area.cards.at(0)?.schedule.due, now.toISOString());
  assert.deepEqual(imported.area.cards.at(0)?.importedSchedule?.reviewEventIds, [
    imported.reviewEvents.at(0)?.id,
  ]);
});

await test("private real SQLite package round-trips actual logs, suspension and FSRS memory", async () => {
  const card = area.cards.at(0);
  assert.ok(card);
  const privateArea = {
    ...area,
    cards: area.cards.map((item) => ({
      ...item,
      schedule: { ...item.schedule, stability: 20, difficulty: 6 },
    })),
  };
  const event = {
    id: createReviewEventId("actual"),
    areaId: area.id,
    cardId: card.id,
    ratedAt: "2026-10-19T12:00:00.000Z",
    rating: "good" as const,
    schedulerFamily: "fsrs" as const,
    schedulerVersion: "test",
    elapsedMs: 1200,
  };
  const bytes = await Effect.runPromise(
    exportAnkiApkg(privateArea, mediaStore, writer, {
      now,
      includeScheduling: true,
      reviewEvents: [event],
      suspendedCardIds: [card.id],
    }),
  );
  const imported = await Effect.runPromise(
    importAnkiApkg(bytes, { now, color: "#123456" }, readAnkiSqliteInDesktop),
  );
  assert.equal(imported.reviewEvents.length, 1);
  assert.equal(imported.reviewEvents.at(0)?.ratedAt, event.ratedAt);
  assert.equal(imported.reviewEvents.at(0)?.rating, event.rating);
  assert.equal(imported.area.cards.at(0)?.schedule.stability, 20);
  assert.equal(imported.area.cards.at(0)?.schedule.difficulty, 6);
  assert.equal(imported.suspendedCardIds?.at(0), imported.area.cards.at(0)?.id);
});
