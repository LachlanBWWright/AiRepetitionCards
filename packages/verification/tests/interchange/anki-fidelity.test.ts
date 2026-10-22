import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { strToU8, zipSync } from "fflate";
import { createReviewEventId, type Workspace } from "@recall/domain";
import {
  applyAnkiImport,
  decodeAnkiScheduling,
  exportAnkiApkg,
  importAnkiApkg,
  type AnkiCollection,
} from "@recall/application";
import { buildAnkiExportStatements } from "../../../application/src/interchange/anki/anki-export-statements";
const now = new Date("2026-10-20T12:00:00Z");
const archive = zipSync({ "collection.anki2": new Uint8Array([1]), media: strToU8("{}") });
const collection: AnkiCollection = {
  deckNames: ["Test"],
  noteTypes: [{ id: 1, name: "Basic", kind: "basic", fields: ["Front", "Back"] }],
  notes: [{ id: 1, guid: "stable-guid", noteTypeId: 1, fields: ["Question", "Answer"], tags: [] }],
  cards: [
    {
      id: 1,
      noteId: 1,
      ordinal: 0,
      scheduling: {
        due: now.toISOString(),
        interval: 12,
        reps: 5,
        lapses: 1,
        state: 2,
        stability: 25,
        difficulty: 4.5,
        suspended: true,
      },
    },
  ],
  reviews: [{ cardId: 1, reviewedAt: now.getTime() - 86400000, ease: 3, type: 1 }],
};
const propose = (data = collection) =>
  Effect.runPromise(importAnkiApkg(archive, { now, color: "#123456" }, () => Effect.succeed(data)));
const empty: Workspace = { schemaVersion: 1, areas: [], reviews: 0 };

await test("reimport updates matching GUID content and preserves local identities and evidence", async () => {
  const first = await propose();
  const saved = await Effect.runPromise(applyAnkiImport(empty, first));
  const original = saved.areas[0]?.cards[0];
  assert.ok(original);
  assert.equal(saved.schedulerSettings?.suspendedCardIds?.[0], original.id);
  assert.equal(original.schedule.stability, 25);
  const updated = await propose({
    ...collection,
    notes: [
      {
        id: 999,
        guid: "stable-guid",
        noteTypeId: 1,
        fields: ["Edited", "Updated"],
        tags: ["new"],
      },
    ],
    cards: [{ id: 999, noteId: 999, ordinal: 0 }],
    reviews: [],
  });
  const merged = await Effect.runPromise(applyAnkiImport(saved, updated));
  assert.equal(merged.areas.length, 1);
  const mergedArea = merged.areas.at(0);
  assert.ok(mergedArea);
  const mergedCard = mergedArea.cards.at(0);
  assert.ok(mergedCard);
  const mergedNote = mergedArea.noteLibrary?.notes.at(0);
  assert.ok(mergedNote);
  assert.equal(mergedArea.cards.length, 1);
  assert.equal(mergedCard.id, original.id);
  assert.equal(mergedCard.front, "Edited");
  assert.deepEqual(mergedCard.schedule, original.schedule);
  assert.deepEqual(merged.reviewEvents, saved.reviewEvents);
  assert.equal(mergedNote.id, first.area.noteLibrary?.notes.at(0)?.id);
  assert.equal(mergedNote.fields.Front, "Edited");
});

await test("ambiguous cross-area matches reject instead of overwriting either area", async () => {
  const first = await propose();
  const second = await propose();
  const duplicate: Workspace = { ...empty, areas: [first.area, second.area] };
  const result = await Effect.runPromise(
    Effect.either(applyAnkiImport(duplicate, await propose())),
  );
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, "ambiguous-matches");
});

await test("private Anki export writes genuine answer grades, timestamps and elapsed time only", async () => {
  const proposal = await propose();
  const event = proposal.reviewEvents[0];
  assert.ok(event);
  const actual = { ...event, elapsedMs: 1234, id: createReviewEventId("actual-answer") };
  const rows = buildAnkiExportStatements(proposal.area, {
    now,
    includeScheduling: true,
    reviewEvents: [actual],
  });
  const log = rows.filter((row) => row.sql.startsWith("INSERT INTO revlog"));
  assert.equal(log.length, 1);
  const logged = log.at(0);
  assert.ok(logged);
  assert.equal(logged.parameters[0], Date.parse(actual.ratedAt));
  assert.equal(logged.parameters[3], 3);
  assert.equal(logged.parameters[7], 1234);
  assert.equal(
    buildAnkiExportStatements(proposal.area, { now, reviewEvents: [actual] }).filter((row) =>
      row.sql.startsWith("INSERT INTO revlog"),
    ).length,
    0,
  );
  const duplicate = { ...actual, id: createReviewEventId("another-answer") };
  const media = {
    get: () => Effect.succeed(null),
    put: () => Effect.void,
    delete: () => Effect.void,
    list: Effect.succeed([]),
  };
  const rejected = await Effect.runPromise(
    Effect.either(
      exportAnkiApkg(proposal.area, media, () => Effect.succeed(new Uint8Array()), {
        now,
        includeScheduling: true,
        reviewEvents: [actual, duplicate],
      }),
    ),
  );
  assert.ok(Either.isLeft(rejected));
  assert.equal(rejected.left.reason, "invalid-area");
});

await test("day-learning and FSRS memory decode without executing custom data", () => {
  const schedule = decodeAnkiScheduling(
    {
      due: 2,
      ivl: 1,
      reps: 3,
      lapses: 0,
      type: 1,
      queue: 3,
      data: JSON.stringify({ s: 12.5, d: 6.2, lrt: now.getTime() / 1000, cd: "ignored" }),
    },
    now.getTime() / 1000,
  );
  assert.ok(schedule);
  assert.equal(schedule.due, "2026-10-22T12:00:00.000Z");
  assert.equal(schedule.stability, 12.5);
  assert.equal(schedule.difficulty, 6.2);
  assert.equal(schedule.lastReview, now.toISOString());
});

await test("Anki imports accept more than the former 500-card limit", async () => {
  const cards = Array.from({ length: 501 }, (_, index) => ({
    id: index + 1,
    noteId: index + 1,
    ordinal: 0,
  }));
  const notes = cards.map((card) => ({
    id: card.noteId,
    guid: `guid-${String(card.id)}`,
    noteTypeId: 1,
    fields: ["Question", "Answer"],
    tags: [],
  }));
  const result = await propose({ ...collection, cards, notes, reviews: [] });
  assert.equal(result.area.cards.length, 501);
});

await test("partial shared-note updates fail rather than leaving a stale sibling", async () => {
  const full = await propose({
    ...collection,
    cards: [
      { id: 1, noteId: 1, ordinal: 0 },
      { id: 2, noteId: 1, ordinal: 1 },
    ],
    reviews: [],
  });
  const workspace = await Effect.runPromise(applyAnkiImport(empty, full));
  const result = await Effect.runPromise(
    Effect.either(applyAnkiImport(workspace, await propose())),
  );
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, "partial-note-family");
});

await test("native Anki image-occlusion packages produce studyable image cards", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const packageBytes = zipSync({
    "collection.anki2": new Uint8Array([1]),
    media: strToU8(JSON.stringify({ "0": "image.png" })),
    "0": bytes,
  });
  const native: AnkiCollection = {
    ...collection,
    noteTypes: [
      {
        id: 1,
        name: "Image Occlusion",
        kind: "cloze",
        fields: ["Occlusion", "Image", "Header", "Back Extra"],
      },
    ],
    notes: [
      {
        id: 1,
        guid: "native-mask",
        noteTypeId: 1,
        fields: [
          "{{c1::image-occlusion:rect:left=.1:top=.1:width=.2:height=.3}}",
          '<img src="image.png">',
          "Identify this",
          "Additional explanation",
        ],
        tags: [],
      },
    ],
  };
  const imported = await Effect.runPromise(
    importAnkiApkg(packageBytes, { now, color: "#123456" }, () => Effect.succeed(native)),
  );
  const card = imported.area.cards.at(0);
  assert.ok(card);
  assert.equal(card.front, "Identify this");
  assert.equal(card.back, "Additional explanation");
  assert.ok(card.imageOcclusion);
  assert.equal(card.imageOcclusion.masks.length, 1);
  assert.equal(card.imageOcclusion.targetMaskIds.length, 1);
  assert.equal(imported.media.length, 1);
});

await test("Anki nested cloze uses the shared cloze renderer", async () => {
  const imported = await propose({
    ...collection,
    noteTypes: [{ id: 1, name: "Cloze", kind: "cloze", fields: ["Text"] }],
    notes: [
      {
        id: 1,
        guid: "nested",
        noteTypeId: 1,
        fields: ["{{c1::outer {{c2::inner}} content}}"],
        tags: [],
      },
    ],
    cards: [
      { id: 1, noteId: 1, ordinal: 0 },
      { id: 2, noteId: 1, ordinal: 1 },
    ],
    reviews: [],
  });
  assert.equal(imported.area.cards.length, 2);
  assert.equal(imported.area.cards.at(0)?.back, "outer inner content");
  assert.ok(imported.area.cards.at(1)?.front.includes("outer"));
  assert.ok(!imported.area.cards.at(1)?.front.includes("{{"));
});
