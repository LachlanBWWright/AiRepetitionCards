import assert from "node:assert/strict";
import test from "node:test";
import { isRendererDocument } from "../../../../apps/desktop/src/main/renderer-document.js";

await test("desktop document trust accepts navigation hashes in development", () => {
  for (const route of ["today", "library", "tutor", "insights"]) {
    assert.equal(
      isRendererDocument(`http://localhost:5173/#/${route}`, "http://localhost:5173"),
      true,
    );
  }
});

await test("packaged document trust accepts hashes on the exact bundled file", () => {
  const expected = "file:///opt/Recall/renderer/index.html";
  assert.equal(isRendererDocument(`${expected}#/library`, expected), true);
  assert.equal(isRendererDocument("file:///tmp/index.html#/today", expected), false);
});

await test("desktop document trust rejects other origins, paths, credentials, and queries", () => {
  const expected = "http://localhost:5173/";
  for (const candidate of [
    undefined,
    "invalid",
    "https://localhost:5173/#/today",
    "http://localhost:5174/#/today",
    "http://attacker.example:5173/#/today",
    "http://localhost:5173/other#/today",
    "http://localhost:5173/?injected=1#/today",
    "http://user:password@localhost:5173/#/today",
    "file:///tmp/index.html",
  ]) {
    assert.equal(isRendererDocument(candidate, expected), false, candidate);
  }
  assert.equal(isRendererDocument(expected, "invalid"), false);
});
