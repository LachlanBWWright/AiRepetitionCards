import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { createAreaId } from "@recall/domain";
import {
  BASIC_NOTE_TYPE,
  REVERSED_NOTE_TYPE,
  formatCardMath,
  parseRichContent,
  parseRichInline,
  prepareNoteSave,
  richInsertion,
  saveStudyNote,
} from "@recall/application";

void test("rich content parses formatting and lists without interpreting HTML or remote images", () => {
  const blocks = parseRichContent(
    "# Heading\n- **Recall** *this* `code`\n2. $E=mc^2$\n<script>alert(1)</script>\n![unsafe](https://example.com/image.png)",
  );
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["heading", "bullet", "number", "paragraph", "paragraph"],
  );
  assert.deepEqual(
    blocks[1]?.content.map((inline) => inline.kind),
    ["strong", "text", "emphasis", "text", "code"],
  );
  assert.equal(blocks[3]?.content[0]?.text, "<script>alert(1)</script>");
  assert.equal(blocks[4]?.content[0]?.kind, "text");
});
void test("inline image references resolve only attachment identities and preserve labels", () => {
  assert.deepEqual(parseRichInline("Before ![Cell](media:abc_123) after"), [
    { kind: "text", text: "Before " },
    { kind: "image", text: "Cell", mediaId: "abc_123" },
    { kind: "text", text: " after" },
  ]);
  assert.equal(parseRichInline("![x](javascript:alert(1))")[0]?.kind, "text");
});
void test("math supports common scientific notation and keeps unsupported source", () => {
  assert.equal(formatCardMath("E=mc^2 + H_2O + \\alpha"), "E=mc² + H₂O + α");
  assert.equal(
    formatCardMath("\\frac{a}{b} + \\sqrt{x} + \\unknown"),
    "(a)/(b) + √(x) + \\unknown",
  );
  assert.equal(richInsertion("Answer", "math"), "Answer $E = mc^2$");
});
void test("preparing a shared type edit allocates new sibling IDs for every affected note", () => {
  const areaId = createAreaId("authoring-area");
  const workspace = {
    schemaVersion: 1 as const,
    reviews: 0,
    areas: [{ id: areaId, title: "Notes", color: "#123456", cards: [] }],
  };
  const first = {
    id: "first",
    typeId: "basic",
    fields: { Front: "Q1", Back: "A1" },
    tags: [],
    objectiveIds: [],
  };
  const second = { ...first, id: "second", fields: { Front: "Q2", Back: "A2" } };
  const savedFirst = Effect.runSync(
    saveStudyNote(
      workspace,
      {
        areaId,
        type: BASIC_NOTE_TYPE,
        note: first,
        cardIds: [{ templateId: "forward", cardId: "first-forward" }],
      },
      new Date("2026-10-20"),
    ),
  );
  const savedSecond = Effect.runSync(
    saveStudyNote(
      savedFirst,
      { areaId, note: second, cardIds: [{ templateId: "forward", cardId: "second-forward" }] },
      new Date("2026-10-20"),
    ),
  );
  const area = savedSecond.areas[0];
  assert.ok(area);
  let sequence = 0;
  const result = Effect.runSync(
    Effect.either(
      prepareNoteSave(
        area,
        { ...REVERSED_NOTE_TYPE, id: "basic" },
        first,
        () => `fresh-${String(++sequence)}`,
      ),
    ),
  );
  assert.ok(Either.isRight(result));
  assert.equal(result.right.kind, "save-note");
  assert.deepEqual(
    result.right.cardIds.map((entry) => [entry.noteId, entry.templateId]),
    [
      ["second", "reverse"],
      ["first", "reverse"],
    ],
  );
});

void test("note drafts retain incomplete type names and protect attachment ownership", async () => {
  const { LibraryNotesSchema, libraryDraftMediaReferences } = await import("@recall/application");
  const { Schema } = await import("effect");
  const reference = { id: "a".repeat(64), mimeType: "image/png", byteLength: 8 };
  const decoded = Schema.decodeUnknownEither(LibraryNotesSchema)({
    version: 1,
    drafts: [],
    flaggedCardIds: [],
    noteDrafts: [
      {
        key: "new-note:area",
        areaId: "area",
        type: {
          ...BASIC_NOTE_TYPE,
          name: "",
          templates: [{ ...BASIC_NOTE_TYPE.templates[0], name: "" }],
        },
        note: {
          id: "draft",
          typeId: "basic",
          fields: { Front: "Unsaved question", Back: "" },
          tags: [],
          objectiveIds: [],
          media: [reference],
        },
        tagsText: "incomplete,",
        baseline: "captured-content",
      },
    ],
  });
  assert.ok(Either.isRight(decoded));
  assert.equal(decoded.right.noteDrafts?.[0]?.type.name, "");
  assert.equal(libraryDraftMediaReferences(decoded.right)[0]?.id, reference.id);
});
