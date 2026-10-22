import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import {
  BASIC_NOTE_TYPE,
  formatRichSelection,
  insertRichText,
  parseRichContent,
  previewStudyNote,
} from "@recall/application";
import { renderCardMath } from "@recall/infra-rich-content";
import { CardAppearanceSchema, ReviewPresentationSchema } from "@recall/domain";
import { Schema } from "effect";

void test("formatting wraps the selection and preserves the surrounding source", () => {
  assert.deepEqual(formatRichSelection("alpha beta gamma", { start: 6, end: 10 }, "bold"), {
    value: "alpha **beta** gamma",
    selection: { start: 8, end: 12 },
  });
  assert.deepEqual(formatRichSelection("ab", { start: 1, end: 1 }, "math"), {
    value: "a$E = mc^2$b",
    selection: { start: 2, end: 10 },
  });
  assert.equal(
    insertRichText("abc", { start: 1, end: 2 }, "![x](media:one)").value,
    "a![x](media:one)c",
  );
});
void test("list formatting prefixes the selected complete lines", () => {
  const result = formatRichSelection("First\nSecond\nThird", { start: 2, end: 10 }, "number");
  assert.equal(result.value, "1. First\n2. Second\nThird");
});
void test("conditional templates nest and never reinterpret field values", () => {
  const type = {
    ...BASIC_NOTE_TYPE,
    fields: [...BASIC_NOTE_TYPE.fields, { name: "Extra" }],
    templates: [
      {
        id: "forward",
        name: "Conditional",
        front: "{{#Front}}{{Front}}{{#Extra}}: {{Extra}}{{/Extra}}{{/Front}}",
        back: "{{Back}}{{^Extra}} (no example){{/Extra}}",
      },
    ],
  };
  const note = {
    id: "note",
    typeId: "basic",
    fields: { Front: "{{#Back}}", Back: "Answer", Extra: "" },
    tags: [],
    objectiveIds: [],
  };
  const preview = Effect.runSync(previewStudyNote(type, note));
  assert.ok(preview[0]);
  assert.equal(preview[0].front, "{{#Back}}");
  assert.equal(preview[0].back, "Answer (no example)");
  for (const front of [
    "{{#Front}}{{Front}}{{/Back}}",
    "{{^Missing}}x{{/Missing}}",
    "{{#Front}}x",
    "{{{Front}}",
  ]) {
    assert.ok(
      Either.isLeft(
        Effect.runSync(
          Effect.either(
            previewStudyNote({ ...type, templates: [{ ...type.templates[0], front }] }, note),
          ),
        ),
      ),
    );
  }
});
void test("safe reusable appearance survives note generation and rejects arbitrary values", () => {
  const appearance = {
    font: "mono",
    size: "large",
    align: "center",
    lineSpacing: "compact",
  } as const;
  assert.ok(Either.isRight(Schema.decodeUnknownEither(CardAppearanceSchema)(appearance)));
  assert.ok(
    Either.isLeft(
      Schema.decodeUnknownEither(CardAppearanceSchema)({
        ...appearance,
        font: "url(https://example.com/font)",
      }),
    ),
  );
  const type = {
    ...BASIC_NOTE_TYPE,
    templates: BASIC_NOTE_TYPE.templates.map((template) => ({
      ...template,
      presentation: { appearance },
    })),
  };
  const note = {
    id: "note",
    typeId: "basic",
    fields: { Front: "Question", Back: "Answer" },
    tags: [],
    objectiveIds: [],
  };
  const preview = Effect.runSync(previewStudyNote(type, note));
  assert.deepEqual(preview[0]?.presentation?.appearance, appearance);
  assert.deepEqual(Schema.decodeUnknownSync(ReviewPresentationSchema)({ appearance }), {
    appearance,
  });
});
void test("inline and multiline display math share TeX source", () => {
  const blocks = parseRichContent(
    "Text \\(x^2\\)\n$$\\begin{matrix}a&b\\\\c&d\\end{matrix}$$\nAfter",
  );
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["paragraph", "math", "paragraph"],
  );
  assert.equal(blocks[0]?.content[1]?.kind, "math");
});
void test("offline math renders fractions, roots, matrices and integrals as paths", () => {
  for (const source of [
    "\\frac{1}{\\sqrt{x^2+1}}",
    "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}",
    "\\int_0^\\infty e^{-x}\\,dx",
  ]) {
    const result = renderCardMath(source, true);
    assert.ok(Either.isRight(result), JSON.stringify(result));
    assert.match(result.right.svg, /<path/);
    assert.ok(result.right.width > 0 && result.right.height > 0);
  }
});
void test("untrusted TeX cannot load extensions or create links and parser state is isolated", () => {
  for (const source of [
    "\\href{javascript:alert(1)}{x}",
    "\\require{html}",
    "\\def\\x{\\x}\\x",
    "\\unknown{x}",
    "x".repeat(4001),
  ])
    assert.ok(Either.isLeft(renderCardMath(source)));
  assert.ok(Either.isRight(renderCardMath("\\def\\custom{x}\\custom")));
  assert.ok(Either.isLeft(renderCardMath("\\custom")));
});
