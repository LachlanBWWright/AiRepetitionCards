import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectEditableMedia } from "../../../../apps/web/src/features/dashboard/authoring/notes/media/media-edit-inspection";
function png(width: number, height: number) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
function wav(rate = 8000, channels = 1, duration = 1) {
  const bytes = new Uint8Array(44 + rate * channels * 2 * duration);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    bytes.set(
      Array.from(value, (letter) => letter.charCodeAt(0)),
      offset,
    );
  };
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, bytes.length - 44, true);
  return bytes;
}
await test("image headers reject oversized dimensions and malformed formats before decoding", () => {
  assert.deepEqual(inspectEditableMedia(png(400, 200), "image/png"), {
    kind: "image",
    width: 400,
    height: 200,
  });
  assert.equal(inspectEditableMedia(png(8193, 1), "image/png"), undefined);
  assert.equal(inspectEditableMedia(png(5000, 5000), "image/png"), undefined);
  assert.equal(
    inspectEditableMedia(new Uint8Array([255, 216, 255, 192, 0, 255]), "image/jpeg"),
    undefined,
  );
  assert.equal(inspectEditableMedia(png(400, 200), "image/jpeg"), undefined);
  const jpeg = new Uint8Array([255, 216, 255, 192, 0, 8, 8, 0, 200, 1, 144, 1]);
  assert.deepEqual(inspectEditableMedia(jpeg, "image/jpeg"), {
    kind: "image",
    width: 400,
    height: 200,
  });
  const webp = new Uint8Array(30);
  webp.set(
    Array.from("RIFF", (x) => x.charCodeAt(0)),
    0,
  );
  webp.set(
    Array.from("WEBPVP8L", (x) => x.charCodeAt(0)),
    8,
  );
  webp[20] = 47;
  new DataView(webp.buffer).setUint32(21, 99 | (49 << 14), true);
  assert.deepEqual(inspectEditableMedia(webp, "image/webp"), {
    kind: "image",
    width: 100,
    height: 50,
  });
  webp.set(
    Array.from("VP8X", (x) => x.charCodeAt(0)),
    12,
  );
  webp[20] = 2;
  assert.equal(inspectEditableMedia(webp, "image/webp"), undefined);
});
await test("WAV duration, channel, rate and sample-layout limits are inspected before codecs", () => {
  assert.equal(inspectEditableMedia(wav(), "audio/wav")?.kind, "audio");
  assert.equal(inspectEditableMedia(wav(8000, 3), "audio/wav"), undefined);
  assert.equal(inspectEditableMedia(wav(192000), "audio/wav"), undefined);
  assert.equal(inspectEditableMedia(wav(8000, 1, 301), "audio/wav"), undefined);
  const malformed = wav();
  new DataView(malformed.buffer).setUint32(40, 0xffffffff, true);
  assert.equal(inspectEditableMedia(malformed, "audio/wav"), undefined);
  assert.equal(inspectEditableMedia(wav(), "audio/mpeg"), undefined);
});
