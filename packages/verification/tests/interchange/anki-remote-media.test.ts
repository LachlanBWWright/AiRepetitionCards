import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeField } from "../../../application/src/interchange/anki/anki-import-media";
import { ankiCompatibilityReport } from "../../../application/src/interchange/anki/anki-compatibility";

await test("remote media becomes visible placeholders without retaining an executable URL", () => {
  const result = sanitizeField(
    'Question<img src="https://example.com/tracking.png" onerror="bad()">' +
      '<img src="//example.com/image.png">[sound:HTTP://example.com/voice.mp3]',
    new Map(),
  );
  assert.ok(result && result !== "invalid-media");
  assert.equal(result.omittedRemoteMedia, 3);
  assert.equal(
    result.text,
    "Question[Remote image not included][Remote image not included][Remote audio not included]",
  );
  assert.deepEqual(result.references, []);
});

await test("missing packaged files and unsafe URL schemes remain rejected", () => {
  for (const source of [
    "missing.png",
    "../image.png",
    "data:image/png;base64,AA",
    "javascript:bad()",
    "file:///private.png",
  ]) {
    assert.equal(sanitizeField(`<img src="${source}">`, new Map()), "invalid-media");
  }
  assert.equal(sanitizeField("[sound:missing.mp3]", new Map()), "invalid-media");
});

await test("remote media in custom templates is included in the approval warning count", () => {
  const report = ankiCompatibilityReport(
    {
      deckNames: ["Custom"],
      noteTypes: [
        {
          id: 1,
          name: "Custom",
          kind: "basic",
          fields: ["Front", "Back"],
          templates: [
            {
              name: "Card",
              front: '{{Front}}<img src="https://example.com/image.png">',
              back: "{{Back}}",
            },
          ],
        },
      ],
      notes: [{ id: 1, guid: "custom", noteTypeId: 1, fields: ["Question", "Answer"], tags: [] }],
      cards: [{ id: 1, noteId: 1, ordinal: 0 }],
    },
    new Map(),
    0,
  );
  assert.equal(report.omittedRemoteMedia, 1);
});
