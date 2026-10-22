import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import { sha256 } from "@noble/hashes/sha2.js";
import { unzipSync } from "fflate";
import {
  createAreaId,
  createAssessmentId,
  MediaReferenceSchema,
  type KnowledgeArea,
  type Workspace,
} from "@recall/domain";
import {
  exportKnowledgeAreaPackage,
  importKnowledgeAreaPackage,
  exportPortableDeckPackage,
  importPortableDeckPackage,
  exportWorkspaceBackupPackage,
  importWorkspaceBackupPackage,
  fromKnowledgeArea,
  isSupportedMediaContent,
  verifyMediaAsset,
} from "@recall/application";
import { mimeFor } from "../../../application/src/interchange/anki/anki-import-media";

const mp4 = new Uint8Array([
  0,
  0,
  0,
  20,
  ...new TextEncoder().encode("ftypM4A "),
  0,
  0,
  0,
  0,
  ...new TextEncoder().encode("isom"),
]);
const webm = new Uint8Array([
  0x1a,
  0x45,
  0xdf,
  0xa3,
  0x87,
  0x42,
  0x82,
  0x84,
  ...new TextEncoder().encode("webm"),
  0x18,
  0x53,
  0x80,
  0x67,
]);
function success<A, E>(effect: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(effect));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}
const assets = (
  [
    { mimeType: "audio/mp4", bytes: mp4 },
    { mimeType: "audio/webm", bytes: webm },
  ] as const
).map(({ mimeType, bytes }) => ({
  bytes,
  reference: Schema.decodeUnknownSync(MediaReferenceSchema)({
    id: Array.from(sha256(bytes), (value) => value.toString(16).padStart(2, "0")).join(""),
    mimeType,
    byteLength: bytes.length,
  }),
}));
const store = {
  get: (id: string) => Effect.succeed(assets.find((asset) => asset.reference.id === id) ?? null),
  put: () => Effect.void,
  delete: () => Effect.void,
  list: Effect.succeed(assets.map((asset) => asset.reference)),
};
const area: KnowledgeArea = {
  schemaVersion: "1.0.0",
  id: createAreaId("audio-subject"),
  title: "Pronunciation",
  description: null,
  language: "en",
  objectives: [],
  ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
  cards: [
    {
      kind: "basic",
      id: createAssessmentId("audio-card"),
      front: "Say this",
      back: "Listen",
      objectiveIds: [],
      tags: [],
      origin: "authored",
      media: assets.map((asset) => asset.reference),
    },
  ],
  tags: [],
  licence: null,
};

void test("recorded audio signatures reject arbitrary, malformed and mislabeled bytes", () => {
  for (const asset of assets) {
    assert.ok(verifyMediaAsset(asset));
    assert.equal(
      isSupportedMediaContent(
        new TextEncoder().encode("arbitrary audio blob"),
        asset.reference.mimeType,
      ),
      false,
    );
    assert.equal(isSupportedMediaContent(asset.bytes.slice(0, 8), asset.reference.mimeType), false);
  }
  const badMp4 = new Uint8Array(mp4);
  badMp4[3] = 255;
  assert.equal(isSupportedMediaContent(badMp4, "audio/mp4"), false);
  const badWebm = new Uint8Array(webm);
  badWebm[8] = 0;
  assert.equal(isSupportedMediaContent(badWebm, "audio/webm"), false);
  assert.equal(isSupportedMediaContent(mp4, "audio/webm"), false);
  assert.equal(mimeFor("voice.m4a", mp4), "audio/mp4");
  assert.equal(mimeFor("voice.webm", webm), "audio/webm");
  assert.equal(mimeFor("voice.m4a", webm), undefined);
});
void test("recorded MP4 and WebM round-trip through authored packages and private backups", () => {
  const packageBytes = success(exportKnowledgeAreaPackage(area, store));
  const paths = Object.keys(unzipSync(packageBytes));
  assert.ok(paths.some((path) => path.endsWith(".m4a")));
  assert.ok(paths.some((path) => path.endsWith(".webm")));
  assert.deepEqual(success(importKnowledgeAreaPackage(packageBytes)).media, assets);
  const portable = success(
    importPortableDeckPackage(success(exportPortableDeckPackage(area, store))),
  );
  assert.deepEqual(portable.media, assets);
  const learningArea = success(
    fromKnowledgeArea(
      area,
      "#112233",
      true,
      () => "unused",
      new Date("2026-10-20T00:00:00Z"),
      true,
    ),
  );
  const workspace: Workspace = { schemaVersion: 1, reviews: 0, areas: [learningArea] };
  const backup = success(
    importWorkspaceBackupPackage(
      success(exportWorkspaceBackupPackage(workspace, "2026-10-20T00:00:00Z", store)),
    ),
  );
  assert.deepEqual(backup.media, assets);
});
