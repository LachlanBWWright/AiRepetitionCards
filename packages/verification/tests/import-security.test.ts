import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { Effect, Either, Schema } from "effect";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  MediaReferenceSchema,
  createAreaId,
  createCardId,
  createObjectiveId,
  type KnowledgeArea,
  type Workspace,
} from "@recall/domain";
import {
  importKnowledgeAreaPackage,
  exportKnowledgeAreaPackage,
  importWorkspaceBackupPackage,
  exportWorkspaceBackupPackage,
  importAnkiApkg,
  importDelimitedCards,
  exportDelimitedCards,
  verifyMediaAsset,
  fromKnowledgeArea,
  type AnkiCollection,
} from "@recall/application";
import { hasSafeZipExpansion } from "../../application/src/zip-safety";

const now = new Date("2026-10-03T00:00:00.000Z");
const areaId = createAreaId("00000000-0000-4000-8000-000000000801");
const cardId = createCardId("00000000-0000-4000-8000-000000000802");
const objectiveId = createObjectiveId("00000000-0000-4000-8000-000000000803");
const document: KnowledgeArea = {
  schemaVersion: "1.0.0",
  id: areaId,
  title: "Learning",
  description: null,
  language: "en",
  objectives: [{ id: objectiveId, title: "Understand", description: null, prerequisiteIds: [] }],
  ai: {
    tutorInstructions: "Ask questions",
    quizInstructions: null,
    cardGenerationInstructions: null,
  },
  cards: [
    {
      kind: "basic",
      id: cardId,
      front: "Question",
      back: "Answer",
      objectiveIds: [objectiveId],
      tags: [],
      origin: "authored",
    },
  ],
  tags: [],
  licence: null,
};
const emptyStore = {
  get: () => Effect.succeed(null),
  put: () => Effect.void,
  delete: () => Effect.void,
  list: Effect.succeed([]),
};
function success<A, E>(operation: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isRight(result));
  return result.right;
}
function rejected<A, E>(operation: Effect.Effect<A, E>) {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isLeft(result));
  return result.left;
}
function archiveWith(path: string, bytes = strToU8("unexpected")): Uint8Array {
  const original = success(exportKnowledgeAreaPackage(document, emptyStore));
  return zipSync({ ...unzipSync(original), [path]: bytes }, { level: 0 });
}
function replaceArchiveName(bytes: Uint8Array, original: string, replacement: string): Uint8Array {
  assert.equal(original.length, replacement.length);
  const output = bytes.slice();
  const from = strToU8(original);
  const to = strToU8(replacement);
  for (let offset = 0; offset <= output.length - from.length; offset += 1) {
    if (from.every((byte, index) => output[offset + index] === byte)) output.set(to, offset);
  }
  return output;
}
function collection(front = "Question", back = "Answer"): AnkiCollection {
  return {
    deckNames: ["Learning"],
    noteTypes: [{ id: 1, name: "Basic", kind: "basic", fields: ["Front", "Back"] }],
    notes: [
      { id: 1, guid: "source-guid", noteTypeId: 1, fields: [front, back], tags: ["imported"] },
    ],
    cards: [{ id: 1, noteId: 1, ordinal: 0 }],
  };
}
const ankiOptions = { color: "#112233", now, createId: () => "generated-source-id" };
const ankiBytes = () =>
  zipSync(
    { "collection.anki2": strToU8("mock database bytes"), media: strToU8("{}") },
    { level: 0 },
  );

void test("canonical ZIP rejects traversal, absolute paths and alternate separators", () => {
  for (const path of [
    "../workspace.json",
    "/workspace.json",
    "C:/workspace.json",
    "media/../escape",
    "media\\escape",
    "./cards.json",
    "media//escape",
  ]) {
    assert.equal(rejected(importKnowledgeAreaPackage(archiveWith(path))).reason, "invalid-package");
  }
});

void test("duplicate archive names and malformed directories are rejected", () => {
  const normal = success(exportKnowledgeAreaPackage(document, emptyStore));
  const cards = unzipSync(normal)["cards.json"];
  assert.ok(cards);
  const duplicate = replaceArchiveName(
    archiveWith("other.json", cards),
    "other.json",
    "cards.json",
  );
  const names: string[] = [];
  unzipSync(duplicate, {
    filter: (entry) => {
      names.push(entry.name);
      return false;
    },
  });
  assert.equal(names.filter((name) => name === "cards.json").length, 2);
  assert.equal(rejected(importKnowledgeAreaPackage(duplicate)).reason, "invalid-package");
  const corrupted = normal.slice();
  const view = new DataView(corrupted.buffer, corrupted.byteOffset, corrupted.byteLength);
  view.setUint32(corrupted.length - 6, 0xffffffff, true);
  assert.equal(rejected(importKnowledgeAreaPackage(corrupted)).reason, "invalid-package");
  rejected(importWorkspaceBackupPackage(normal.slice(0, normal.length - 22)));
});

void test("ZIP expansion ratios and entry limits stop hostile input before Anki reader invocation", () => {
  let reads = 0;
  const reader = () => {
    reads += 1;
    return Effect.succeed(collection());
  };
  const bomb = zipSync({ bomb: new Uint8Array(80_000) }, { level: 9 });
  assert.equal(rejected(importKnowledgeAreaPackage(bomb)).reason, "limits-exceeded");
  assert.equal(rejected(importAnkiApkg(bomb, ankiOptions, reader)).reason, "limits-exceeded");
  const files = Object.fromEntries(
    Array.from({ length: 2001 }, (_, index) => [String(index), new Uint8Array()]),
  );
  const excessive = zipSync(files, { level: 0 });
  assert.equal(rejected(importAnkiApkg(excessive, ankiOptions, reader)).reason, "limits-exceeded");
  assert.equal(rejected(importKnowledgeAreaPackage(excessive)).reason, "limits-exceeded");
  assert.equal(reads, 0);
});

void test("Anki rejects unsafe paths and duplicate media indexes before adapter invocation", () => {
  let reads = 0;
  const reader = () => {
    reads += 1;
    return Effect.succeed(collection());
  };
  for (const path of ["../escape", "/escape", "C:/escape", "folder\\escape"]) {
    const bytes = zipSync({ ...unzipSync(ankiBytes()), [path]: strToU8("unsafe") }, { level: 0 });
    assert.equal(rejected(importAnkiApkg(bytes, ankiOptions, reader)).reason, "invalid-archive");
  }
  const duplicate = replaceArchiveName(
    zipSync({ ...unzipSync(ankiBytes()), extra: strToU8("{}") }, { level: 0 }),
    "extra",
    "media",
  );
  assert.equal(rejected(importAnkiApkg(duplicate, ankiOptions, reader)).reason, "invalid-archive");
  assert.equal(reads, 0);
});

void test("directory expansion guard rejects forged sizes and oversized aggregate metadata", () => {
  fc.assert(
    fc.property(fc.integer({ min: 65537, max: 1000000 }), (originalSize) => {
      const entry = { name: "entry", size: 1, originalSize, compression: 8 };
      assert.equal(
        hasSafeZipExpansion([entry], { maxFiles: 128, maxExpandedBytes: 1000000 }),
        false,
      );
    }),
    { numRuns: 40, seed: 801 },
  );
  for (const size of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(
      hasSafeZipExpansion([{ name: "entry", size, originalSize: 1, compression: 0 }], {
        maxFiles: 128,
        maxExpandedBytes: 1000000,
      }),
      false,
    );
  }
  assert.equal(
    hasSafeZipExpansion([{ name: "entry", size: 100, originalSize: 100, compression: 0 }], {
      maxFiles: 128,
      maxExpandedBytes: 99,
    }),
    false,
  );
});

void test("MIME, length and digest must agree for media acceptance", () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const id = Array.from(sha256(png), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const reference = success(
    Schema.decodeUnknown(MediaReferenceSchema)({
      id,
      mimeType: "image/png",
      byteLength: png.length,
    }),
  );
  assert.equal(verifyMediaAsset({ reference, bytes: png }), true);
  const mediaDocument: KnowledgeArea = {
    ...document,
    cards: document.cards.map((card) => ({ ...card, media: [reference] })),
  };
  const validPackage = success(
    exportKnowledgeAreaPackage(mediaDocument, {
      ...emptyStore,
      get: () => Effect.succeed({ reference, bytes: png }),
    }),
  );
  assert.equal(success(importKnowledgeAreaPackage(validPackage)).media.length, 1);
  const badMime = { ...reference, mimeType: "audio/ogg" as const };
  assert.equal(
    rejected(
      exportKnowledgeAreaPackage(
        { ...document, cards: document.cards.map((card) => ({ ...card, media: [badMime] })) },
        { ...emptyStore, get: () => Effect.succeed({ reference: badMime, bytes: png }) },
      ),
    ).reason,
    "media-unavailable",
  );
  assert.equal(
    verifyMediaAsset({ reference: { ...reference, mimeType: "audio/ogg" }, bytes: png }),
    false,
  );
  assert.equal(
    verifyMediaAsset({ reference: { ...reference, byteLength: png.length + 1 }, bytes: png }),
    false,
  );
  const modified = png.slice();
  modified[8] = 9;
  assert.equal(verifyMediaAsset({ reference, bytes: modified }), false);
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 255 }), (changed) => {
      const bytes = png.slice();
      bytes[0] = changed === 137 ? 136 : changed;
      assert.equal(verifyMediaAsset({ reference, bytes }), false);
    }),
    { numRuns: 30, seed: 802 },
  );
});

void test("Anki mapping removes executable HTML and rejects reader schemas or unknown templates", () => {
  const malicious = collection(
    '<script>stealSecrets()</script><iframe>tracking</iframe><b onclick="steal()">Safe</b><a href="javascript:steal()">visible</a>',
    "<style>tracking</style><svg>tracking</svg>Answer",
  );
  const imported = success(
    importAnkiApkg(ankiBytes(), ankiOptions, () => Effect.succeed(malicious)),
  );
  const card = imported.area.cards[0];
  assert.ok(card);
  assert.match(card.front, /Safe/);
  assert.doesNotMatch(
    `${card.front} ${card.back}`,
    /script|iframe|onclick|javascript:|steal|tracking|<[^>]*>/i,
  );
  assert.equal(imported.provenance.noteGuids[0], "source-guid");
  assert.equal(
    rejected(importAnkiApkg(ankiBytes(), ankiOptions, () => Effect.succeed({ untrusted: true })))
      .reason,
    "invalid-database",
  );
  assert.equal(
    rejected(
      importAnkiApkg(ankiBytes(), ankiOptions, () =>
        Effect.succeed({
          ...collection(),
          noteTypes: [{ id: 1, name: "Custom", kind: "unsupported", fields: [] }],
        }),
      ),
    ).reason,
    "unsupported-note-type",
  );
});

void test("modern Anki packages reject malformed Zstandard and oversized declared windows", () => {
  let reads = 0;
  const reader = () => {
    reads += 1;
    return Effect.succeed(collection());
  };
  const packageFor = (payload: Uint8Array) =>
    zipSync(
      { meta: new Uint8Array([8, 3]), "collection.anki21b": payload, media: new Uint8Array() },
      { level: 0 },
    );
  assert.equal(
    rejected(importAnkiApkg(packageFor(strToU8("not zstandard")), ankiOptions, reader)).reason,
    "invalid-database",
  );
  assert.equal(
    rejected(
      importAnkiApkg(
        packageFor(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 255])),
        ankiOptions,
        reader,
      ),
    ).reason,
    "limits-exceeded",
  );
  assert.equal(reads, 0);
});

void test("CSV/TSV malformed fields, row limits and spreadsheet formulas remain bounded", () => {
  const malformed = importDelimitedCards(
    'front,back\n"unclosed,answer',
    ",",
    "Imported",
    "#112233",
    now,
  );
  assert.equal(malformed._tag, "Failure");
  assert.equal(malformed.reason, "invalid-quote");
  const excessive = importDelimitedCards(
    `front,back\n${Array.from({ length: 501 }, () => "Q,A").join("\n")}`,
    ",",
    "Imported",
    "#112233",
    now,
  );
  assert.equal(excessive._tag, "Failure");
  const area = success(fromKnowledgeArea(document, "#112233", true, () => "unused", now));
  for (const formula of ["=SUM(A1)", "+danger", "-danger", "@danger"]) {
    for (const delimiter of [",", "\t"] as const) {
      const output = exportDelimitedCards(
        { ...area, cards: area.cards.map((card) => ({ ...card, front: formula })) },
        delimiter,
      );
      assert.ok(output.includes(`'${formula}`));
    }
  }
});

void test("private backup retains learner state while portable packages exclude it and reject tampering", () => {
  const area = success(fromKnowledgeArea(document, "#112233", true, () => "unused", now));
  const workspace: Workspace = {
    schemaVersion: 1,
    areas: [area],
    reviews: 0,
    reviewEvents: [],
    schedulerSettings: { requestRetention: 0.91 },
  };
  const backup = success(exportWorkspaceBackupPackage(workspace, now.toISOString(), emptyStore));
  assert.deepEqual(success(importWorkspaceBackupPackage(backup)).workspace, workspace);
  for (const path of ["../workspace.json", "/workspace.json", "C:/workspace.json"]) {
    const malicious = zipSync({ ...unzipSync(backup), [path]: strToU8("unsafe") }, { level: 0 });
    assert.equal(rejected(importWorkspaceBackupPackage(malicious)).reason, "invalid-backup");
  }
  const files = unzipSync(backup);
  files["workspace.json"] = strToU8(JSON.stringify({ ...workspace, reviews: 999 }));
  assert.equal(
    rejected(importWorkspaceBackupPackage(zipSync(files, { level: 0 }))).reason,
    "invalid-backup",
  );
  const portable = success(
    importKnowledgeAreaPackage(success(exportKnowledgeAreaPackage(document, emptyStore))),
  );
  assert.equal("reviews" in portable.knowledgeArea, false);
  assert.equal("schedulerSettings" in portable.knowledgeArea, false);
  const exportedCard = portable.knowledgeArea.cards[0];
  assert.ok(exportedCard);
  assert.equal("schedule" in exportedCard, false);
  const unknown = {
    ...unzipSync(success(exportKnowledgeAreaPackage(document, emptyStore))),
    "knowledge-area.json": strToU8(JSON.stringify({ ...document, schemaVersion: "99.0.0" })),
  };
  assert.equal(
    rejected(importKnowledgeAreaPackage(zipSync(unknown, { level: 0 }))).reason,
    "invalid-package",
  );
});
