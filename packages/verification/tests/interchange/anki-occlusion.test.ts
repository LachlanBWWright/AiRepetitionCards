import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "effect";
import { MediaIdSchema } from "@recall/domain";
import { importAnkiOcclusion } from "../../../application/src/interchange/anki/anki-import-occlusion";
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const reference = {
  id: Schema.decodeUnknownSync(MediaIdSchema)("a".repeat(64)),
  mimeType: "image/png" as const,
  byteLength: bytes.length,
};
const media = new Map([["image.png", { reference, bytes }]]);
const fields = (occlusion: string) =>
  new Map([
    ["image", '<img src="image.png">'],
    ["occlusion", occlusion],
  ]);

await test("native Anki occlusion keeps mask groups, geometry and hide modes without imported scripts", () => {
  const rect = "{{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.4:oi=1}}";
  const ellipse = "{{c1::image-occlusion:ellipse:left=.5:top=.5:rx=.1:ry=.2:oi=1}}";
  const other = "{{c2::image-occlusion:rect:left=.1:top=.1:width=.1:height=.1:oi=1}}";
  const imported = importAnkiOcclusion(fields(rect + ellipse + other), 0, media);
  assert.ok(imported);
  assert.equal(imported.image.mode, "hide-all");
  assert.equal(imported.image.masks.length, 3);
  assert.equal(imported.image.targetMaskIds.length, 2);
  assert.equal(imported.image.masks.at(1)?.shape, "ellipse");
  assert.deepEqual(imported.image.masks.at(1)?.points, [
    { x: 0.5, y: 0.5 },
    { x: 0.7, y: 0.9 },
  ]);
  assert.equal(
    importAnkiOcclusion(fields(rect.replace(":oi=1", "")), 0, media)?.image.mode,
    "hide-one",
  );
});

await test("unsupported or invalid native occlusion geometry fails instead of creating a different mask", () => {
  for (const raw of [
    "{{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.4:angle=.5}}",
    "{{c1::image-occlusion:rect:left=.9:top=.2:width=.3:height=.4}}",
    "{{c1::image-occlusion:polygon:left=.1:top=.2:points=0,0 .2,.2}}",
    "{{c1::image-occlusion:text:left=.1:top=.2:text=label}}",
  ])
    assert.equal(importAnkiOcclusion(fields(raw), 0, media), undefined);
});
