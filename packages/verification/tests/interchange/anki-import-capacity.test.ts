import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Fiber } from "effect";
import { strToU8, zipSync, unzipSync } from "fflate";
import { importAnkiApkg, exportAnkiApkg, type AnkiCollection } from "@recall/application";
import {
  MAX_FILES,
  MAX_MEDIA_ASSETS,
} from "../../../application/src/interchange/anki/anki-import-archive";
const now = new Date("2026-10-20T12:00:00Z");
const data: AnkiCollection = {
  deckNames: ["Study"],
  noteTypes: [{ id: 1, name: "Basic", kind: "basic", fields: ["Front", "Back"] }],
  notes: [{ id: 1, guid: "guid", noteTypeId: 1, fields: ["<b>Question</b>", "Answer"], tags: [] }],
  cards: [{ id: 1, noteId: 1, ordinal: 0 }],
};
const packageBytes = zipSync({ "collection.anki2": new Uint8Array([1]), media: strToU8("{}") });

await test("bounded compatibility report shows source and safe conversion before approval", async () => {
  const result = await Effect.runPromise(
    importAnkiApkg(packageBytes, { now, color: "#123456" }, () => Effect.succeed(data)),
  );
  assert.equal(result.compatibility?.changedFieldCount, 1);
  assert.deepEqual(result.compatibility.samples[0], {
    noteGuid: "guid",
    fieldName: "Front",
    original: "<b>Question</b>",
    imported: "Question",
  });
  assert.equal(result.area.cards[0]?.front, "Question");
});

await test("media collections above the previous 100 attachment cap import within byte budgets", async () => {
  const count = MAX_MEDIA_ASSETS;
  const manifest = Object.fromEntries(
    Array.from({ length: count }, (_, index) => [String(index), `image-${String(index)}.png`]),
  );
  const entries = Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      String(index),
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, Math.floor(index / 256), index % 256]),
    ]),
  );
  const bytes = zipSync({
    ...entries,
    "collection.anki2": new Uint8Array([1]),
    media: strToU8(JSON.stringify(manifest)),
  });
  const collection = {
    ...data,
    notes: Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      guid: `media-${String(index)}`,
      noteTypeId: 1,
      fields: [`Question <img src="image-${String(index)}.png">`, "Answer"],
      tags: [],
    })),
    cards: Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      noteId: index + 1,
      ordinal: 0,
    })),
  };
  const result = await Effect.runPromise(
    importAnkiApkg(bytes, { now, color: "#123456" }, () => Effect.succeed(collection)),
  );
  assert.equal(result.compatibility?.omittedUnreferencedAttachments, 0);
  assert.equal(result.media.length, count);
  const assets = new Map(result.media.map((asset) => [asset.reference.id, asset]));
  const exported = await Effect.runPromise(
    exportAnkiApkg(
      result.area,
      {
        get: (id) => Effect.succeed(assets.get(id) ?? null),
        put: () => Effect.void,
        delete: () => Effect.void,
        list: Effect.succeed(result.media.map((asset) => asset.reference)),
      },
      () => Effect.succeed(new Uint8Array([1])),
      { now },
    ),
  );
  assert.equal(Object.keys(unzipSync(exported)).length, count + 2);
});

await test("checkpoint pause resumes the same import without reopening SQLite", async () => {
  let resume: (() => void) | undefined;
  let reads = 0;
  const checkpoint = (progress: import("@recall/application").AnkiImportProgress) =>
    progress.phase === "archive"
      ? Effect.async<undefined>((done) => {
          resume = () => {
            done(Effect.succeed(undefined));
          };
        })
      : Effect.void;
  const fiber = Effect.runFork(
    importAnkiApkg(
      packageBytes,
      {
        now,
        color: "#123456",
        control: { checkpoint },
      },
      () => {
        reads += 1;
        return Effect.succeed(data);
      },
    ),
  );
  await new Promise<void>((done) => setImmediate(done));
  assert.ok(resume);
  assert.equal(reads, 0);
  resume();
  await Effect.runPromise(Fiber.join(fiber));
  assert.equal(reads, 1);
});

await test("interrupting a paused import never invokes the database adapter", async () => {
  let reads = 0;
  const fiber = Effect.runFork(
    importAnkiApkg(
      packageBytes,
      { now, color: "#123456", control: { checkpoint: () => Effect.never } },
      () => {
        reads += 1;
        return Effect.succeed(data);
      },
    ),
  );
  await Effect.runPromise(Fiber.interrupt(fiber));
  assert.equal(reads, 0);
});

await test("entry capacity retains a small fixed overhead above the media cap", () => {
  assert.ok(MAX_FILES >= MAX_MEDIA_ASSETS + 5);
});

await test("already compressed media packages above 50 MB fit the unchanged decoded budget", async () => {
  const files = Object.fromEntries(
    Array.from({ length: 3 }, (_, index) => {
      const bytes = new Uint8Array(17_000_000);
      bytes.set([137, 80, 78, 71, 13, 10, 26, 10, index]);
      return [String(index), bytes];
    }),
  );
  const manifest = { "0": "one.png", "1": "two.png", "2": "three.png" };
  const bytes = zipSync(
    { ...files, "collection.anki2": new Uint8Array([1]), media: strToU8(JSON.stringify(manifest)) },
    { level: 0 },
  );
  assert.ok(bytes.byteLength > 50_000_000);
  const collection = {
    ...data,
    notes: [
      {
        id: 1,
        guid: "media",
        noteTypeId: 1,
        fields: ['Question <img src="one.png"><img src="two.png"><img src="three.png">', "Answer"],
        tags: [],
      },
    ],
  };
  const result = await Effect.runPromise(
    importAnkiApkg(bytes, { now, color: "#123456" }, () => Effect.succeed(collection)),
  );
  assert.equal(result.media.length, 3);
  assert.equal(
    result.media.reduce((size, asset) => size + asset.bytes.byteLength, 0),
    51_000_000,
  );
});

await test("Zstandard rejects concatenated frames before decoding a second large window", async () => {
  const { decompressZstd } =
    await import("../../../application/src/interchange/anki/anki-import-archive");
  const single = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x20, 1, 9, 0, 0, 65]);
  assert.deepEqual(decompressZstd(single, 1024), new Uint8Array([65]));
  const second = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 255, 1, 0, 0]);
  const concatenated = new Uint8Array([...single, ...second]);
  assert.equal(decompressZstd(concatenated, 1024), "invalid");
});

await test("import retains verified attachments used only by an editable note field", async () => {
  const bytes = zipSync({
    "collection.anki2": new Uint8Array([1]),
    media: strToU8('{"0":"extra.png"}'),
    "0": new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  });
  const collection: AnkiCollection = {
    ...data,
    noteTypes: [{ id: 1, name: "Extra", kind: "basic", fields: ["Front", "Back", "Extra"] }],
    notes: [
      {
        id: 1,
        guid: "note-media",
        noteTypeId: 1,
        fields: ["Question", "Answer", '<img src="extra.png">'],
        tags: [],
      },
    ],
  };
  const result = await Effect.runPromise(
    importAnkiApkg(bytes, { now, color: "#123456" }, () => Effect.succeed(collection)),
  );
  assert.equal(result.area.cards[0]?.media?.length, 0);
  assert.equal(result.area.noteLibrary?.notes[0]?.media?.length, 1);
  assert.equal(result.media.length, 1);
  assert.equal(result.compatibility?.omittedUnreferencedAttachments, 0);
});
