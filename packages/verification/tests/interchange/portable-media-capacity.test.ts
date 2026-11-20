import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import { sha256 } from "@noble/hashes/sha2.js";
import { zipSync } from "fflate";
import {
  createAreaId,
  createAssessmentId,
  MediaReferenceSchema,
  type KnowledgeArea,
} from "@recall/domain";
import type { MediaStore, StoredMediaAsset } from "@recall/local-store";
import { exportPortableDeckPackage, importPortableDeckPackage } from "@recall/application";

function image(index: number): StoredMediaAsset {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, index & 255, index >> 8]);
  const id = Array.from(sha256(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
  const reference = Schema.decodeUnknownSync(MediaReferenceSchema)({
    id,
    mimeType: "image/png",
    byteLength: bytes.length,
  });
  return { reference, bytes };
}

void test("a media-heavy imported deck remains fully exportable with verified attachment bytes", () => {
  const assets = Array.from({ length: 2_000 }, (_, index) => image(index));
  const byId = new Map(assets.map((asset) => [asset.reference.id, asset]));
  const store: MediaStore = {
    get: (id) => Effect.succeed(byId.get(id) ?? null),
    put: () => Effect.void,
    delete: () => Effect.void,
    list: Effect.succeed(assets.map((asset) => asset.reference)),
  };
  const area: KnowledgeArea = {
    schemaVersion: "1.0.0",
    id: createAreaId("00000000-0000-4000-8000-000000000111"),
    title: "Media-heavy collection",
    description: null,
    language: "en",
    objectives: [],
    ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
    cards: assets.map(({ reference }, index) => ({
      kind: "basic",
      id: createAssessmentId(`media-card-${String(index)}`),
      front: `Image ${String(index)}`,
      back: "Answer",
      objectiveIds: [],
      tags: [],
      origin: "authored",
      media: [reference],
    })),
    tags: [],
    licence: null,
  };
  const archive = Effect.runSync(Effect.either(exportPortableDeckPackage(area, store)));
  assert.ok(Either.isRight(archive));
  const imported = Effect.runSync(Effect.either(importPortableDeckPackage(archive.right)));
  assert.ok(Either.isRight(imported));
  assert.equal(imported.right.media.length, 2_000);
  assert.deepEqual(imported.right.knowledgeArea, area);
  for (const asset of imported.right.media) {
    assert.deepEqual(asset.bytes, byId.get(asset.reference.id)?.bytes);
  }
});

void test("larger portable packages still reject excess file counts before parsing content", () => {
  const files = Object.fromEntries(
    Array.from({ length: 2_011 }, (_, index) => [
      `media/${index.toString(16).padStart(64, "0")}.png`,
      image(index).bytes,
    ]),
  );
  const result = Effect.runSync(Effect.either(importPortableDeckPackage(zipSync(files))));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, "limits-exceeded");
});
