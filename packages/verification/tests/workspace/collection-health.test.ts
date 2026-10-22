import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import { sha256 } from "@noble/hashes/sha2.js";
import { createAssessmentId, MediaReferenceSchema, type Workspace } from "@recall/domain";
import {
  inspectCollection,
  maintainCollectionMedia,
  captureCardVersion,
  workspaceMediaReferences,
} from "@recall/application";
import type { MediaStore, StoredMediaAsset } from "@recall/local-store";
import { newSchedule } from "@recall/scheduler";
import { areaId } from "../fixtures/search-workspace";
const now = new Date("2026-10-20T00:00:00Z");
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const reference = Schema.decodeUnknownSync(MediaReferenceSchema)({
  id: Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, "0")).join(""),
  mimeType: "image/png",
  byteLength: bytes.length,
});
const asset: StoredMediaAsset = { reference, bytes };
const missing = Schema.decodeUnknownSync(MediaReferenceSchema)({
  ...reference,
  id: "b".repeat(64),
});
function fixture(): Workspace {
  return {
    schemaVersion: 1,
    reviews: 0,
    areas: [
      {
        id: areaId,
        title: "Health",
        color: "#123456",
        cards: [
          {
            id: createAssessmentId("health-card"),
            front: "Question",
            back: "Answer",
            objective: "Topic",
            schedule: newSchedule(now),
            media: [missing],
          },
        ],
      },
    ],
  };
}
function store(assets: readonly StoredMediaAsset[]): MediaStore {
  return {
    list: Effect.succeed(assets.map((a) => a.reference)),
    get: (id) => Effect.succeed(assets.find((a) => a.reference.id === id) ?? null),
    put: () => Effect.void,
    delete: () => Effect.void,
  };
}
void test("collection scan distinguishes missing, unused and corrupt without writes", () => {
  const broken: StoredMediaAsset = { reference: missing, bytes: new Uint8Array([0]) };
  const report = Effect.runSync(inspectCollection(fixture(), store([asset])));
  assert.deepEqual(report.missing, [missing]);
  assert.deepEqual(report.unused, [reference]);
  assert.deepEqual(report.corrupt, []);
  const corrupt = Effect.runSync(inspectCollection(fixture(), store([broken])));
  assert.deepEqual(corrupt.corrupt, [missing]);
});
void test("recoverable history and shared notes protect media from cleanup", () => {
  const original = fixture();
  const area = original.areas[0];
  assert.ok(area);
  const card = area.cards[0];
  assert.ok(card);
  const withHistory = captureCardVersion(
    original,
    area,
    { ...card, media: [reference] },
    "edit",
    now,
  );
  assert.ok(workspaceMediaReferences(withHistory).some((r) => r.id === reference.id));
  const result = Effect.runSync(
    Effect.either(
      maintainCollectionMedia(
        withHistory,
        { kind: "maintain-collection-media", action: "trash", references: [reference] },
        now,
      ),
    ),
  );
  assert.ok(Either.isLeft(result));
  const withNote: Workspace = {
    ...original,
    areas: [
      {
        ...area,
        noteLibrary: {
          types: [
            {
              id: "basic",
              name: "Basic",
              fields: [{ name: "Front" }],
              templates: [{ id: "forward", name: "Forward", front: "{{Front}}", back: "answer" }],
            },
          ],
          notes: [
            {
              id: "note",
              typeId: "basic",
              fields: { Front: "Question" },
              tags: [],
              objectiveIds: [],
              media: [reference],
            },
          ],
        },
      },
    ],
  };
  assert.ok(workspaceMediaReferences(withNote).some((r) => r.id === reference.id));
});
void test("unused media trash is reversible and tagging snapshots original content", () => {
  const original = fixture();
  const trashed = Effect.runSync(
    maintainCollectionMedia(
      original,
      { kind: "maintain-collection-media", action: "trash", references: [reference] },
      now,
    ),
  );
  assert.equal(trashed.mediaTrash?.length, 1);
  const scan = Effect.runSync(inspectCollection(trashed, store([asset])));
  assert.deepEqual(scan.unused, []);
  const restored = Effect.runSync(
    maintainCollectionMedia(
      trashed,
      { kind: "maintain-collection-media", action: "restore", references: [reference] },
      now,
    ),
  );
  assert.deepEqual(restored.mediaTrash, []);
  const tagged = Effect.runSync(
    maintainCollectionMedia(
      original,
      { kind: "maintain-collection-media", action: "tag-missing", references: [missing] },
      now,
    ),
  );
  assert.deepEqual(tagged.areas[0]?.cards[0]?.tags, ["missing-media"]);
  assert.equal(tagged.cardVersions?.length, 1);
  assert.equal(tagged.cardVersions[0]?.card.tags, undefined);
  assert.deepEqual(original.areas[0]?.cards[0]?.media, [missing]);
});
void test("scan checks expected content metadata and identifies invalid card references", () => {
  const original = fixture();
  const area = original.areas[0];
  assert.ok(area);
  const card = area.cards[0];
  assert.ok(card);
  const workspace: Workspace = {
    ...original,
    areas: [
      {
        ...area,
        cards: [
          {
            ...card,
            front: " ",
            noteId: "missing-note",
            media: [{ ...reference, byteLength: reference.byteLength + 1 }],
          },
        ],
      },
    ],
  };
  const scan = Effect.runSync(inspectCollection(workspace, store([asset])));
  assert.deepEqual(scan.corrupt, [reference]);
  assert.ok(scan.issues.some((i) => i.empty));
  assert.ok(scan.issues.some((i) => i.message.includes("source note")));
});

void test("retained editor drafts protect attachments during a scan", () => {
  const report = Effect.runSync(inspectCollection(fixture(), store([asset]), [reference]));
  assert.deepEqual(report.unused, []);
});
