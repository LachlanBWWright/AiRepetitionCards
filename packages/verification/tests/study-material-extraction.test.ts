import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { strToU8, zipSync, zlibSync } from "fflate";
import {
  extractPastedStudyText,
  extractStudyMaterial,
  MAX_STUDY_FILE_BYTES,
  type ExtractedStudyMaterial,
  type StudyMaterialExtractionFailure,
} from "../../infra-study-materials/src/index";

async function success(
  operation: Effect.Effect<ExtractedStudyMaterial, StudyMaterialExtractionFailure>,
) {
  const result = await Effect.runPromise(Effect.either(operation));
  assert.ok(Either.isRight(result), Either.isLeft(result) ? result.left.message : "");
  return result.right;
}
async function rejected(
  operation: Effect.Effect<ExtractedStudyMaterial, StudyMaterialExtractionFailure>,
  reason: StudyMaterialExtractionFailure["reason"],
) {
  const result = await Effect.runPromise(Effect.either(operation));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, reason);
}
function utf16(text: string, littleEndian: boolean): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]);
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    bytes.set(littleEndian ? [unit & 255, unit >>> 8] : [unit >>> 8, unit & 255], 2 + index * 2);
  }
  return bytes;
}
const xml = (body: string, prefix = "w") =>
  `<?xml version="1.0" encoding="UTF-8"?><${prefix}:document xmlns:${prefix}="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><${prefix}:body>${body}</${prefix}:body></${prefix}:document>`;
function docx(body: string | Uint8Array) {
  return zipSync({ "word/document.xml": typeof body === "string" ? strToU8(body) : body });
}

/** Small valid files generated locally; no fixture downloads or external PDF renderer. */
function pdf(pages: readonly string[], compressed = false, encrypted = false): Uint8Array {
  const fontId = 3 + pages.length * 2;
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from(
      `<< /Type /Pages /Count ${String(pages.length)} /Kids [${pages.map((_, index) => `${String(3 + index * 2)} 0 R`).join(" ")}] >>`,
    ),
  ];
  for (const [index, content] of pages.entries()) {
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${String(fontId)} 0 R >> >> /Contents ${String(4 + index * 2)} 0 R >>`,
      ),
    );
    const bytes = compressed ? zlibSync(strToU8(content)) : strToU8(content);
    objects.push(
      Buffer.concat([
        Buffer.from(
          `<< /Length ${String(bytes.length)}${compressed ? " /Filter /FlateDecode" : ""} >>\nstream\n`,
        ),
        bytes,
        Buffer.from("\nendstream"),
      ]),
    );
  }
  objects.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));
  if (encrypted)
    objects.push(
      Buffer.from(
        `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${"01".repeat(32)}> /U <${"02".repeat(32)}> /P -4 >>`,
      ),
    );
  const chunks = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let length = chunks[0]?.length ?? 0;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${String(index + 1)} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(chunk);
    length += chunk.length;
  }
  chunks.push(
    Buffer.from(
      `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R${encrypted ? ` /Encrypt ${String(objects.length)} 0 R /ID [<${"03".repeat(16)}> <${"03".repeat(16)}>]` : ""} >>\nstartxref\n${String(length)}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}
const pageText = (text: string) => `BT /F1 12 Tf 50 740 Td (${text}) Tj ET`;

void test("UTF-8 and Markdown retain Unicode, code and newlines", async () => {
  const text = "# Notes\r\nCafé, Ελληνικά, 日本語 🧠\r\n```go\r\n\treturn a[0]\r\n```";
  const result = await success(extractStudyMaterial("NOTES.MD", strToU8(text)));
  assert.equal(result.format, "markdown");
  assert.equal(result.sections[0]?.text, text.replace(/\r\n/g, "\n"));
});
void test("UTF-8 BOM and UTF-16 little/big endian exports decode correctly", async () => {
  const text = "Study café 日本語 🧠";
  const bom = new Uint8Array(3 + strToU8(text).length);
  bom.set([0xef, 0xbb, 0xbf]);
  bom.set(strToU8(text), 3);
  for (const bytes of [bom, utf16(text, true), utf16(text, false)]) {
    const result = await success(extractStudyMaterial("notes.txt", bytes));
    assert.equal(result.sections[0]?.text, text);
  }
});
void test("invalid encodings and binary disguised as text are rejected", async () => {
  for (const bytes of [
    new Uint8Array([0xc3, 0x28]),
    new Uint8Array([0xff]),
    new Uint8Array([65, 0, 66]),
    new Uint8Array([0xff, 0xfe, 65]),
    utf16("\ud800", true),
    utf16("\udc00", false),
  ])
    await rejected(extractStudyMaterial("notes.txt", bytes), "invalid-document");
});
void test("empty text, unsupported formats and limits produce typed failures", async () => {
  await rejected(extractStudyMaterial("empty.txt", strToU8(" \n\t")), "no-text");
  await rejected(extractStudyMaterial("notes.doc", strToU8("notes")), "unsupported-format");
  await rejected(
    extractStudyMaterial("large.txt", new Uint8Array(MAX_STUDY_FILE_BYTES + 1)),
    "too-large",
  );
  await rejected(extractPastedStudyText("Paste", "x".repeat(2_000_001)), "too-large");
});
void test("long pasted passages split without losing Unicode or text", async () => {
  const text = "x".repeat(19_999) + "🧠" + "y".repeat(20_005);
  const result = await success(extractPastedStudyText("Long passage", text));
  assert.equal(result.sections.map((section) => section.text).join(""), text);
  assert.ok(result.sections.every((section) => section.text.length <= 20_000));
});
void test("DOCX extracts paragraphs, runs, tabs, line breaks, tables and entities", async () => {
  const body =
    "<w:p><w:r><w:t>First &amp; second 🧠</w:t><w:tab/><w:t>tabbed</w:t><w:br/><w:t>next line</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell one</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell two</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:del><w:r><w:delText>Deleted text</w:delText></w:r></w:del><w:ins><w:r><w:t>Inserted text</w:t></w:r></w:ins></w:p>";
  const result = await success(extractStudyMaterial("workshop.docx", docx(xml(body))));
  assert.equal(result.format, "docx");
  const text = result.sections.map((section) => section.text).join("\n");
  assert.ok(text.includes("First & second 🧠\ttabbed\nnext line"));
  assert.ok(
    text.includes("Cell one") && text.includes("Cell two") && text.includes("Inserted text"),
  );
  assert.ok(!text.includes("Deleted text"));
});
void test("DOCX handles alternate namespace prefixes and UTF-16 XML", async () => {
  const result = await success(
    extractStudyMaterial(
      "notes.docx",
      docx(xml("<word:p><word:r><word:t>Alternate prefix</word:t></word:r></word:p>", "word")),
    ),
  );
  assert.equal(result.sections[0]?.text, "Alternate prefix");
  const encoded = utf16(
    xml("<w:p><w:r><w:t>UTF-16 notes 🧠</w:t></w:r></w:p>").replace(
      'encoding="UTF-8"',
      'encoding="UTF-16"',
    ),
    true,
  );
  assert.equal(
    (await success(extractStudyMaterial("unicode.docx", docx(encoded)))).sections[0]?.text,
    "UTF-16 notes 🧠",
  );
});
void test("DOCX rejects corrupt ZIP, missing body, malformed XML and entities", async () => {
  await rejected(extractStudyMaterial("bad.docx", strToU8("not a zip")), "invalid-document");
  await rejected(
    extractStudyMaterial("missing.docx", zipSync({ "other.xml": strToU8("unused") })),
    "invalid-document",
  );
  await rejected(extractStudyMaterial("broken.docx", docx(xml("<w:p>"))), "invalid-document");
  await rejected(
    extractStudyMaterial(
      "entity.docx",
      docx('<!DOCTYPE x [<!ENTITY x "injected">]>' + xml("<w:p><w:r><w:t>&x;</w:t></w:r></w:p>")),
    ),
    "invalid-document",
  );
});
void test("DOCX requires a main document body and rejects empty documents", async () => {
  await rejected(
    extractStudyMaterial("fake.docx", docx("<root><t>Not a Word document</t></root>")),
    "invalid-document",
  );
  await rejected(
    extractStudyMaterial(
      "missing-body.docx",
      docx('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'),
    ),
    "invalid-document",
  );
  await rejected(extractStudyMaterial("empty.docx", docx(xml(""))), "no-text");
});
void test("DOCX expansion limits reject oversized highly compressed bodies", async () => {
  await rejected(
    extractStudyMaterial(
      "bomb.docx",
      docx(xml(`<w:p><w:r><w:t>${"x".repeat(1_000_000)}</w:t></w:r></w:p>`)),
    ),
    "invalid-document",
  );
});
void test("PDF extracts compressed multipage text with correct source page numbers", async () => {
  const result = await success(
    extractStudyMaterial(
      "workshop.pdf",
      pdf(
        [
          pageText("Go slices share storage."),
          "BT /F1 12 Tf 50 740 Td (Second page.) Tj 0 -20 Td (Another line.) Tj ET",
        ],
        true,
      ),
    ),
  );
  assert.equal(result.format, "pdf");
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[0]?.pageNumber, 1);
  assert.equal(result.sections[1]?.pageNumber, 2);
  assert.equal(result.sections[0].text, "Go slices share storage.");
  assert.ok(result.sections[1].text.includes("Second page."));
  assert.ok(result.sections[1].text.includes("Another line."));
});
void test("PDF preserves readable pages while warning about scanned or blank pages", async () => {
  const result = await success(
    extractStudyMaterial("mixed.pdf", pdf(["", pageText("Readable page")])),
  );
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0]?.pageNumber, 2);
  assert.ok(result.warnings.some((warning) => warning.includes("Page 1 has no readable text")));
});
void test("blank, malformed and encrypted PDF failures are classified", async () => {
  await rejected(extractStudyMaterial("scan.pdf", pdf([""])), "no-text");
  await rejected(extractStudyMaterial("bad.pdf", strToU8("not a PDF")), "invalid-document");
  await rejected(
    extractStudyMaterial("locked.pdf", pdf([pageText("Private")], false, true)),
    "encrypted-pdf",
  );
});
