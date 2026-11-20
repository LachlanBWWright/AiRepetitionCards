import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import { createAreaId, createAssessmentId, WorkspaceSchema } from "@recall/domain";
import {
  BASIC_NOTE_TYPE,
  exportDelimitedCards,
  importDelimitedCards,
  createStudyCard,
  updateStudyCard,
  toKnowledgeArea,
  fromKnowledgeArea,
  parseRichContent,
  parseRichInline,
  renderCloze,
  insertEquation,
  equationSelection,
  previewStudyNote,
  applyWorkspaceAuthoringCommand,
} from "@recall/application";
import { cardEquationError } from "@recall/infra-rich-content";

const now = new Date("2026-10-25T12:00:00Z");
const areaId = createAreaId("math-area");
const empty = {
  schemaVersion: 1 as const,
  reviews: 0,
  areas: [{ id: areaId, title: "Math", color: "#123456", cards: [] }],
};
const content = {
  kind: "basic" as const,
  front: "What is energy?",
  back: "Work capacity.",
  explanation: "A worked example: \\(E=mc^2\\).",
  tags: [],
  media: [],
  objectiveIds: [],
};
void test("math parsing protects currency, escapes, code spans and fenced code", () => {
  assert.deepEqual(
    parseRichInline("Costs $5 and $10; \\$20; `$x$` and \\(x^2\\)").filter(
      (item) => item.kind === "math",
    ),
    [{ kind: "math", text: "x^2" }],
  );
  assert.equal(parseRichInline("$2$ and $2x$").filter((item) => item.kind === "math").length, 2);
  const blocks = parseRichContent(
    '```rust\nlet x = "$$not math$$";\n```\n`\\[not math\\]`\n\\[\\frac{a}{b}\\]',
  );
  assert.deepEqual(
    blocks.map((item) => item.kind),
    ["code", "paragraph", "math"],
  );
  assert.equal(blocks[0]?.language, "rust");
  assert.equal(blocks[0].content[0]?.text, 'let x = "$$not math$$";');
  assert.equal(blocks[1]?.content[0]?.kind, "code");
  assert.equal(parseRichContent("```\n$x$")[0]?.kind, "code");
  assert.equal(parseRichContent("\\$\\$literal\\$\\$")[0]?.kind, "paragraph");
  assert.equal(parseRichContent("before \\[unclosed")[0]?.content[0]?.text, "before \\[unclosed");
});
void test("nested TeX groups do not terminate cloze deletions or disappear on reveal", () => {
  const expression = "\\(\\frac{a}{\\frac{b}{c}}\\)";
  const result = Effect.runSync(renderCloze(`Compute {{c1::${expression}::fraction}}.`, 1));
  assert.equal(result.front, "Compute [fraction].");
  assert.equal(result.back, `Compute ${expression}.`);
  assert.equal(
    parseRichInline(result.back).find((item) => item.kind === "math")?.text,
    "\\frac{a}{\\frac{b}{c}}",
  );
});
void test("equation insertion replaces only the selection and uses interoperable TeX delimiters", () => {
  assert.equal(
    insertEquation("Use x here", { start: 4, end: 5 }, "\\frac{a}{b}", false).value,
    "Use \\(\\frac{a}{b}\\) here",
  );
  assert.equal(
    insertEquation("abc", { start: 1, end: 2 }, "x^2", true).value,
    "a\n\\[\nx^2\n\\]\nc",
  );
  assert.deepEqual(equationSelection("\\(x^2\\)", { start: 0, end: 7 }), {
    source: "x^2",
    display: false,
  });
  assert.equal(cardEquationError("\\frac{a}{b}"), null);
  assert.notEqual(cardEquationError("\\frac{"), null);
  assert.notEqual(cardEquationError(""), null);
});
void test("explanations survive editing, local schema decoding and portable content round trips", () => {
  const cardId = createAssessmentId("energy");
  const command = { areaId, cardId, content };
  const created = Effect.runSync(createStudyCard(empty, command, now));
  const decoded = Schema.decodeUnknownSync(WorkspaceSchema)(JSON.parse(JSON.stringify(created)));
  assert.equal(decoded.areas[0]?.cards[0]?.explanation, content.explanation);
  const area = decoded.areas[0];
  assert.ok(area);
  const document = Effect.runSync(toKnowledgeArea(area, true, true));
  assert.equal(document.cards[0]?.explanation, content.explanation);
  const restored = Effect.runSync(fromKnowledgeArea(document, "#123456", true, () => "copy", now));
  assert.equal(restored.cards[0]?.explanation, content.explanation);
  const { explanation: omitted, ...legacy } = content;
  assert.ok(omitted);
  const edited = Effect.runSync(
    updateStudyCard(decoded, { ...command, content: { ...legacy, back: "Updated answer." } }, now),
  );
  assert.equal(edited.areas[0]?.cards[0]?.explanation, content.explanation);
  assert.deepEqual(edited.areas[0].cards[0].schedule, area.cards[0]?.schedule);
  const cleared = Effect.runSync(
    updateStudyCard(edited, { ...command, content: { ...legacy, explanation: "" } }, now),
  );
  assert.equal(cleared.areas[0]?.cards[0]?.explanation, undefined);
  assert.ok(
    cleared.cardVersions?.some((version) => version.card.explanation === content.explanation),
  );
  assert.ok(
    Either.isLeft(
      Effect.runSync(
        Effect.either(
          createStudyCard(
            empty,
            { ...command, content: { ...content, explanation: "x".repeat(10001) } },
            now,
          ),
        ),
      ),
    ),
  );
});
void test("linked and ordinary cloze notes retain supporting material separately from the answer", () => {
  const type = {
    ...BASIC_NOTE_TYPE,
    fields: [...BASIC_NOTE_TYPE.fields, { name: "Extra" }],
    templates: BASIC_NOTE_TYPE.templates.map((template) => ({
      ...template,
      explanation: "{{Extra}}",
    })),
  };
  const preview = Effect.runSync(
    previewStudyNote(type, {
      id: "note",
      typeId: type.id,
      fields: { Front: "Q", Back: "A", Extra: "Because." },
      tags: [],
      objectiveIds: [],
    }),
  );
  assert.equal(preview[0]?.back, "A");
  assert.equal(preview[0].explanation, "Because.");
  const saved = Effect.runSync(
    applyWorkspaceAuthoringCommand(
      empty,
      {
        kind: "create-card",
        areaId,
        cardId: createAssessmentId("cloze-card"),
        content: {
          ...content,
          kind: "cloze",
          cloze: { text: "Energy is {{c1::work capacity}}.", deletionIndex: 1 },
        },
      },
      now,
    ),
  ).workspace;
  assert.equal(saved.areas[0]?.cards[0]?.explanation, content.explanation);
});

void test("CSV and TSV preserve optional explanations without changing legacy column layouts", () => {
  const saved = Effect.runSync(
    createStudyCard(
      empty,
      {
        areaId,
        cardId: createAssessmentId("csv"),
        content: { ...content, explanation: 'Reason, with "quotes".\nA second line.' },
      },
      now,
    ),
  );
  const area = saved.areas[0];
  assert.ok(area);
  for (const delimiter of [",", "\t"] as const) {
    let sequence = 0;
    const imported = importDelimitedCards(
      exportDelimitedCards(area, delimiter),
      delimiter,
      "Copied",
      area.color,
      now,
      () => `csv-${String(++sequence)}`,
    );
    assert.equal(imported._tag, "Success");
    assert.equal(imported.area.cards[0]?.explanation, area.cards[0]?.explanation);
  }
});
