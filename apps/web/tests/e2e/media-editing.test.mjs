import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test, withBrowser, storyUrl, expectVisible } from "./helpers.mjs";

test("image crop and resize stores a validated new image, leaving source untouched", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("authoring-media-editing--default"));
    const image = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 200;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ff0000";
      context.fillRect(0, 0, 400, 200);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const source = Buffer.from(image, "base64");
    const originalHash = createHash("sha256").update(source).digest("hex");
    await page
      .getByLabel("Choose media")
      .setInputFiles({ name: "source.png", mimeType: "image/png", buffer: source });
    await expectVisible(page.getByRole("dialog", { name: "Crop and resize image" }));
    await page.getByLabel("Left (%)", { exact: true }).fill("90");
    await page.getByRole("button", { name: "Attach edited copy" }).click();
    await expectVisible(
      page.getByText("Choose a crop within the image and a width from 16 to 4096 pixels."),
    );
    await page.getByLabel("Left (%)", { exact: true }).fill("0");
    await page.getByLabel("Crop width (%)", { exact: true }).fill("50");
    await page.getByLabel("Crop height (%)", { exact: true }).fill("50");
    await page.getByLabel("Maximum output width (px)").fill("100");
    await page.getByRole("button", { name: "Attach edited copy" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const result = JSON.parse(await page.getByLabel("Edited attachment").textContent());
    assert.equal(result.width, 100);
    assert.equal(result.height, 50);
    assert.equal(result.mimeType, "image/png");
    assert.match(result.id, /^[0-9a-f]{64}$/);
    assert.notEqual(result.id, originalHash);
    assert.equal(createHash("sha256").update(source).digest("hex"), originalHash);
  });
});

test("audio trimming stores only approved range as hashed portable WAV", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("authoring-media-editing--default"));
    const rate = 8000;
    const seconds = 2;
    const wave = Buffer.alloc(44 + rate * seconds * 2);
    wave.write("RIFF", 0);
    wave.writeUInt32LE(wave.length - 8, 4);
    wave.write("WAVEfmt ", 8);
    wave.writeUInt32LE(16, 16);
    wave.writeUInt16LE(1, 20);
    wave.writeUInt16LE(1, 22);
    wave.writeUInt32LE(rate, 24);
    wave.writeUInt32LE(rate * 2, 28);
    wave.writeUInt16LE(2, 32);
    wave.writeUInt16LE(16, 34);
    wave.write("data", 36);
    wave.writeUInt32LE(wave.length - 44, 40);
    for (let frame = 0; frame < rate * seconds; frame++)
      wave.writeInt16LE(Math.round(Math.sin(frame * 0.1) * 12000), 44 + frame * 2);
    const originalHash = createHash("sha256").update(wave).digest("hex");
    await page
      .getByLabel("Choose media")
      .setInputFiles({ name: "source.wav", mimeType: "audio/wav", buffer: wave });
    await page.waitForFunction(() => document.querySelector("audio")?.duration === 2);
    await page.getByLabel("Start (seconds)").fill("0.5");
    await page.getByLabel("End (seconds)").fill("1.25");
    await page.getByRole("button", { name: "Attach edited copy" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const result = JSON.parse(await page.getByLabel("Edited attachment").textContent());
    assert.equal(result.duration, 0.75);
    assert.equal(result.mimeType, "audio/wav");
    assert.match(result.id, /^[0-9a-f]{64}$/);
    assert.notEqual(result.id, originalHash);
    assert.equal(createHash("sha256").update(wave).digest("hex"), originalHash);
  });
});

test("oversized crop output is rejected before canvas allocation", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("authoring-media-editing--default"));
    const source = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const data = canvas.toDataURL("image/png").split(",")[1];
      window.createImageBitmap = async () => ({ width: 1, height: 100_000_000, close() {} });
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "height");
      Object.defineProperty(HTMLCanvasElement.prototype, "height", {
        ...descriptor,
        set(value) {
          if (value > 8192) {
            window.oversizedCanvasAllocated = true;
            return;
          }
          descriptor.set.call(this, value);
        },
      });
      return data;
    });
    await page.getByLabel("Choose media").setInputFiles({
      name: "tall.png",
      mimeType: "image/png",
      buffer: Buffer.from(source, "base64"),
    });
    await page.getByRole("button", { name: "Attach edited copy" }).click();
    await expectVisible(
      page.getByText("The media could not be edited. Try a supported file or a smaller selection."),
    );
    assert.equal(await page.getByLabel("Edited attachment").textContent(), "");
    assert.equal(await page.evaluate(() => window.oversizedCanvasAllocated === true), false);
  });
});

test("oversized image metadata and compressed audio never reach preview codecs", async (t) => {
  await withBrowser(t, async ({ page }) => {
    await page.goto(storyUrl("authoring-media-editing--default"));
    await page.evaluate(() => {
      window.unsafeBitmapDecoderCalled = false;
      window.unsafeAudioDecoderCalled = false;
      window.createImageBitmap = () => {
        window.unsafeBitmapDecoderCalled = true;
        return Promise.resolve({ width: 1, height: 1, close() {} });
      };
      window.AudioContext = class {
        constructor() {
          window.unsafeAudioDecoderCalled = true;
        }
        async decodeAudioData() {
          return { duration: 0, length: 0 };
        }
        async close() {}
      };
    });
    const oversized = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).copy(oversized);
    oversized.writeUInt32BE(100000, 16);
    oversized.writeUInt32BE(100000, 20);
    await page
      .getByLabel("Choose media")
      .setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: oversized });
    await expectVisible(page.getByText(/Preview and editing unavailable/));
    assert.equal(await page.getByRole("button", { name: "Attach edited copy" }).isDisabled(), true);
    assert.equal(await page.locator("img,audio").count(), 0);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByLabel("Choose media").setInputFiles({
      name: "compressed.mp3",
      mimeType: "audio/mpeg",
      buffer: Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]),
    });
    await expectVisible(page.getByText(/Preview and editing unavailable/));
    assert.equal(await page.getByRole("button", { name: "Attach original" }).isEnabled(), true);
    assert.equal(await page.locator("img,audio").count(), 0);
    assert.equal(await page.evaluate(() => window.unsafeBitmapDecoderCalled), false);
    assert.equal(await page.evaluate(() => window.unsafeAudioDecoderCalled), false);
  });
});
