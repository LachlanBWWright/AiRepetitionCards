import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { Effect, Either } from "effect";
import { strToU8, zipSync } from "fflate";
import {
  extractPastedStudyText,
  extractStudyMaterial,
  type StudyMaterialExtractionFailure,
} from "../../infra-study-materials/src/index";

async function success<A>(operation: Effect.Effect<A, StudyMaterialExtractionFailure>) {
  const result = await Effect.runPromise(Effect.either(operation));
  assert.ok(Either.isRight(result), Either.isLeft(result) ? result.left.message : "");
  return result.right;
}
async function rejected<A>(
  operation: Effect.Effect<A, StudyMaterialExtractionFailure>,
  reason: StudyMaterialExtractionFailure["reason"],
) {
  const result = await Effect.runPromise(Effect.either(operation));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, reason);
}
const xml = (body: string) =>
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const archive = (body: string) =>
  zipSync({ "word/document.xml": strToU8(xml(body)) }, { level: 0 });

void test("newline at the section boundary does not create an oversized extracted section", async () => {
  for (const offset of [19_999, 20_000, 20_001]) {
    const result = await success(
      extractPastedStudyText("Boundary", `${"x".repeat(offset)}\n${"y".repeat(20_001)}`),
    );
    assert.ok(result.sections.every((section) => section.text.length <= 20_000));
    assert.equal(
      result.sections
        .map((section) => section.text)
        .join("")
        .replaceAll("\n", ""),
      "x".repeat(offset) + "y".repeat(20_001),
    );
  }
});

void test("seeded extraction around section bounds never splits a Unicode surrogate pair", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 19_990, max: 20_010 }),
      fc.constantFrom("🧠", "🚀", "𐐀"),
      async (offset, character) => {
        const original = "x".repeat(offset) + character + "y".repeat(20_005);
        const result = await success(extractPastedStudyText("Unicode", original));
        assert.equal(result.sections.map((section) => section.text).join(""), original);
        for (const section of result.sections) {
          assert.ok(section.text.length <= 20_000);
          assert.doesNotMatch(section.text, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
        }
      },
    ),
    { seed: 10502, numRuns: 35 },
  );
});

void test("two-million-character paste is allowed exactly and over-limit input is rejected", async () => {
  const original = "x".repeat(2_000_000);
  const result = await success(extractPastedStudyText("Maximum", original));
  assert.equal(result.sections.length, 100);
  assert.equal(result.sections.map((section) => section.text).join(""), original);
  await rejected(extractPastedStudyText("Maximum", original + "x"), "too-large");
});

void test("empty pasted names receive a valid title and long file names are bounded", async () => {
  assert.equal(
    (await success(extractPastedStudyText(" \t", "notes"))).sections[0]?.title,
    "Pasted text",
  );
  const result = await success(
    extractStudyMaterial(`${"名".repeat(400)}.markdown`, strToU8("notes")),
  );
  assert.equal(result.format, "markdown");
  assert.ok(result.sections.every((section) => section.title.length <= 200));
});

void test("DOCX ignores relationship targets and non-body text without leaking their content", async () => {
  const bytes = zipSync(
    {
      "word/document.xml": strToU8(xml(paragraph("Visible &lt;script&gt; is text"))),
      "word/_rels/document.xml.rels": strToU8(
        '<Relationships><Relationship Target="https://example.invalid/secrets" TargetMode="External"/></Relationships>',
      ),
      "word/header1.xml": strToU8(paragraph("Hidden header")),
      "word/comments.xml": strToU8(paragraph("Private comment")),
      "../outside.xml": strToU8(paragraph("Outside file")),
    },
    { level: 0 },
  );
  const result = await success(extractStudyMaterial("notes.docx", bytes));
  assert.equal(result.sections[0]?.text, "Visible <script> is text");
  assert.ok(result.warnings.some((warning) => warning.includes("Only document-body text")));
  assert.doesNotMatch(
    JSON.stringify(result.sections),
    /secrets|Hidden header|Private comment|Outside file/,
  );
});

void test("DOCX numeric entities preserve Unicode and deleted text is absent", async () => {
  const result = await success(
    extractStudyMaterial(
      "notes.docx",
      archive(
        paragraph("&#x65E5;&#26412;&#x1F9E0; &quot;quoted&quot; &amp;#65;") +
          "<w:p><w:r><w:delText>Removed</w:delText></w:r></w:p>",
      ),
    ),
  );
  assert.equal(result.sections[0]?.text, '日本🧠 "quoted" &#65;');
});

void test("DOCX excessive structure depth fails through the typed size channel", async () => {
  await rejected(
    extractStudyMaterial(
      "nested.docx",
      archive("<w:sdt>".repeat(55) + paragraph("notes") + "</w:sdt>".repeat(55)),
    ),
    "too-large",
  );
});

void test("DOCX entry count includes ignored entries and rejects over-limit archives", async () => {
  const ignored = Object.fromEntries(
    Array.from({ length: 5000 }, (_, index) => [`ignored/${String(index)}`, new Uint8Array()]),
  );
  const bytes = zipSync(
    { ...ignored, "word/document.xml": strToU8(xml(paragraph("notes"))) },
    { level: 0 },
  );
  await rejected(extractStudyMaterial("too-many.docx", bytes), "invalid-document");
});

void test("DOCX whitespace-only runs produce no-text instead of empty successful sections", async () => {
  await rejected(
    extractStudyMaterial(
      "empty.docx",
      archive(paragraph(" \n\t ") + "<w:p><w:r><w:tab/><w:br/></w:r></w:p>"),
    ),
    "no-text",
  );
});

void test("DOCX declared main-document expansion over eight million bytes is rejected", async () => {
  await rejected(
    extractStudyMaterial("huge.docx", archive(paragraph("x".repeat(8_000_001)))),
    "invalid-document",
  );
});

void test("format selection follows the file extension and does not silently reinterpret binary inputs", async () => {
  const bytes = archive(paragraph("notes"));
  await rejected(extractStudyMaterial("notes.txt", bytes), "invalid-document");
  await rejected(extractStudyMaterial("notes.docx.exe", bytes), "unsupported-format");
  assert.equal(
    (await success(extractStudyMaterial("NOTES.MARKDOWN", strToU8("# notes")))).format,
    "markdown",
  );
});

void test("unknown named and out-of-range numeric XML entities remain literal, without executing expansion", async () => {
  const text = "Literal &unknown; and &#x110000;";
  const result = await success(extractStudyMaterial("unknown.docx", archive(paragraph(text))));
  assert.equal(result.sections[0]?.text, text);
});

void test("malformed numeric XML references fail through invalid-document", async () => {
  for (const reference of ["&#-1;", "&#xZZ;"])
    await rejected(
      extractStudyMaterial("bad-entity.docx", archive(paragraph(reference))),
      "invalid-document",
    );
});

void test("entity declarations remain rejected when numeric decoding is enabled", async () => {
  const declaration =
    '<!DOCTYPE document [<!ENTITY external SYSTEM "https://example.invalid/private">]>';
  const bytes = zipSync(
    { "word/document.xml": strToU8(declaration + xml(paragraph("&external;"))) },
    { level: 0 },
  );
  await rejected(extractStudyMaterial("external.docx", bytes), "invalid-document");
});
