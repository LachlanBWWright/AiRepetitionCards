import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { strToU8, zipSync } from "fflate";

// No browser or network: execute the browser bundle with no Node globals. This
// catches vendor imports that type checks and Metro compilation cannot detect.
const result = await build({
  stdin: {
    contents:
      'import {Effect} from "effect"; import {extractStudyMaterial} from "./src/index.ts"; export const parse = (name, bytes) => Effect.runPromise(Effect.either(extractStudyMaterial(name, bytes)));',
    resolveDir: fileURLToPath(new URL("../../infra-study-materials/", import.meta.url)),
  },
  write: false,
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "StudyParser",
  target: "es2022",
  logLevel: "silent",
});
const context = {
  TextDecoder,
  TextEncoder,
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int32Array,
  ArrayBuffer,
  URL,
  AbortController,
  AbortSignal,
  ReadableStream,
  structuredClone,
  setTimeout,
  clearTimeout,
  queueMicrotask,
  performance,
  console,
};
runInNewContext(result.outputFiles[0].text, context, { timeout: 10_000 });
async function parsedText(name, bytes) {
  const outcome = await context.StudyParser.parse(name, bytes);
  assert.equal(outcome._tag, "Right", outcome.left?.message);
  return outcome.right.sections.map((section) => section.text).join("\n");
}
const text = "Offline notes 日本語 🧠";
assert.equal(await parsedText("notes.md", strToU8(text)), text);
const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
assert.equal(await parsedText("notes.docx", zipSync({ "word/document.xml": strToU8(xml) })), text);

const content = "BT /F1 12 Tf 50 740 Td (Offline PDF parsing.) Tj ET";
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];
let pdf = "%PDF-1.4\n";
const offsets = [];
for (const [index, object] of objects.entries()) {
  offsets.push(pdf.length);
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = pdf.length;
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
assert.equal(await parsedText("notes.pdf", strToU8(pdf)), "Offline PDF parsing.");
console.log("TXT/Markdown, DOCX and PDF parsing work without Node globals or network access.");
