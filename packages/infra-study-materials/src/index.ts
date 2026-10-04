import { Effect, Schema } from "effect";
import { strFromU8, strToU8, unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export const MAX_STUDY_FILE_BYTES = 16 * 1024 * 1024;
const maxTextCharacters = 2_000_000;
const maxSectionCharacters = 20_000;
const maxSections = 500;
export const ExtractedStudyMaterialSchema = Schema.Struct({
  format: Schema.Literal("paste", "txt", "markdown", "docx", "pdf", "image"),
  sections: Schema.Array(
    Schema.Struct({
      title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
      pageNumber: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive())),
      text: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(maxSectionCharacters)),
    }),
  ).pipe(Schema.minItems(1), Schema.maxItems(maxSections)),
  warnings: Schema.Array(Schema.String.pipe(Schema.maxLength(1000))),
});
export type ExtractedStudyMaterial = typeof ExtractedStudyMaterialSchema.Type;
export type StudyMaterialExtractionFailure = {
  readonly _tag: "StudyMaterialExtractionFailure";
  readonly reason:
    | "unsupported-format"
    | "too-large"
    | "invalid-document"
    | "no-text"
    | "encrypted-pdf"
    | "extraction-failed";
  readonly message: string;
};
const failure = (
  reason: StudyMaterialExtractionFailure["reason"],
  message: string,
): StudyMaterialExtractionFailure => ({
  _tag: "StudyMaterialExtractionFailure",
  reason,
  message,
});
type Section = ExtractedStudyMaterial["sections"][number];
const XmlNodes = Schema.Array(Schema.Record({ key: Schema.String, value: Schema.Unknown }));
function xmlElement(nodes: typeof XmlNodes.Type, localName: string): unknown {
  return nodes
    .flatMap((node) => Object.entries(node))
    .find(([name]) => name.split(":").at(-1) === localName)?.[1];
}

/** Decode common text exports without silently replacing malformed byte sequences. */
function decodeText(bytes: Uint8Array): Effect.Effect<string, StudyMaterialExtractionFailure> {
  return Effect.gen(function* () {
    const littleEndian = bytes[0] === 0xff && bytes[1] === 0xfe;
    const bigEndian = bytes[0] === 0xfe && bytes[1] === 0xff;
    if (littleEndian || bigEndian) {
      if (bytes.length % 2 !== 0)
        return yield* Effect.fail(
          failure("invalid-document", "This UTF-16 document is truncated."),
        );
      const characters: string[] = [];
      let previousHighSurrogate = false;
      for (let offset = 2; offset < bytes.length; offset += 2) {
        const first = bytes[offset] ?? 0;
        const second = bytes[offset + 1] ?? 0;
        const unit = littleEndian ? first + second * 256 : first * 256 + second;
        const high = unit >= 0xd800 && unit <= 0xdbff;
        const low = unit >= 0xdc00 && unit <= 0xdfff;
        if (unit === 0)
          return yield* Effect.fail(
            failure("invalid-document", "This UTF-16 document contains binary null characters."),
          );
        if (low !== previousHighSurrogate || (previousHighSurrogate && high))
          return yield* Effect.fail(
            failure("invalid-document", "This UTF-16 document contains invalid characters."),
          );
        characters.push(String.fromCharCode(unit));
        previousHighSurrogate = high;
      }
      if (previousHighSurrogate)
        return yield* Effect.fail(
          failure("invalid-document", "This UTF-16 document is truncated."),
        );
      return characters.join("");
    }
    const content =
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
    const text = yield* Effect.try({
      try: () => strFromU8(content),
      catch: () => failure("invalid-document", "This file could not be decoded as UTF-8 text."),
    });
    const encoded = strToU8(text);
    if (encoded.length !== content.length || encoded.some((byte, index) => byte !== content[index]))
      return yield* Effect.fail(
        failure(
          "invalid-document",
          "This file contains invalid UTF-8. Export it as UTF-8 or UTF-16 with a byte-order mark.",
        ),
      );
    if (text.includes("\u0000"))
      return yield* Effect.fail(
        failure(
          "invalid-document",
          "This appears to be binary data or text with an unsupported encoding. Export it as UTF-8 or UTF-16 with a byte-order mark.",
        ),
      );
    return text;
  });
}

function splitText(text: string, title: string, pageNumber: number | null): readonly Section[] {
  const sections: Section[] = [];
  let remaining = text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  while (remaining.length > 0) {
    let length = Math.min(remaining.length, maxSectionCharacters);
    if (remaining.length > length) {
      const newline = remaining.lastIndexOf("\n", length);
      if (newline > length / 2) length = newline + 1;
      else if (/^[\uDC00-\uDFFF]/.test(remaining.slice(length, length + 1))) length -= 1;
    }
    const part = remaining.slice(0, length).trim();
    remaining = remaining.slice(length);
    if (part)
      sections.push({
        title: `${title.slice(0, 170)}${sections.length ? ` · continued ${String(sections.length + 1)}` : ""}`,
        pageNumber,
        text: part,
      });
  }
  return sections;
}
function checked(
  input: ExtractedStudyMaterial,
): Effect.Effect<ExtractedStudyMaterial, StudyMaterialExtractionFailure> {
  if (input.sections.length === 0)
    return Effect.fail(
      failure(
        "no-text",
        "No readable text was found. Use the scanned PDF/image OCR import or paste corrected text.",
      ),
    );
  if (
    input.sections.reduce((sum, section) => sum + section.text.length, 0) > maxTextCharacters ||
    input.sections.length > maxSections
  )
    return Effect.fail(
      failure(
        "too-large",
        "The extracted document is too large. Import smaller files or selected passages.",
      ),
    );
  return Schema.decodeUnknown(ExtractedStudyMaterialSchema)(input).pipe(
    Effect.mapError(() =>
      failure("invalid-document", "The extracted document could not be validated."),
    ),
  );
}
export function extractPastedStudyText(
  name: string,
  text: string,
): Effect.Effect<ExtractedStudyMaterial, StudyMaterialExtractionFailure> {
  if (text.length > maxTextCharacters)
    return Effect.fail(
      failure("too-large", "Paste a smaller passage; the text limit is two million characters."),
    );
  return checked({
    format: "paste",
    sections: splitText(text, name.trim() || "Pasted text", null),
    warnings: [],
  });
}

function docxText(bytes: Uint8Array): Effect.Effect<string, StudyMaterialExtractionFailure> {
  return Effect.gen(function* () {
    const archiveBounds = { unsafe: false, entries: 0 };
    const files = yield* Effect.try({
      try: () =>
        unzipSync(bytes, {
          filter: (file) => {
            archiveBounds.entries += 1;
            if (archiveBounds.entries > 5000) archiveBounds.unsafe = true;
            if (file.name !== "word/document.xml") return false;
            if (
              file.originalSize > 8_000_000 ||
              file.originalSize > Math.max(65_536, file.size * 200)
            ) {
              archiveBounds.unsafe = true;
              return false;
            }
            return true;
          },
        }),
      catch: () =>
        failure(
          "invalid-document",
          "This DOCX archive could not be read. Export it again or paste its text.",
        ),
    });
    const document = files["word/document.xml"];
    if (archiveBounds.unsafe || !document)
      return yield* Effect.fail(
        failure(
          "invalid-document",
          "This DOCX is missing its main document or exceeds extraction limits.",
        ),
      );
    const xml = yield* decodeText(document);
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))
      return yield* Effect.fail(
        failure(
          "invalid-document",
          "DOCX documents containing entity declarations are unsupported.",
        ),
      );
    const tree: unknown = yield* Effect.try({
      try: (): unknown => {
        if (XMLValidator.validate(xml) !== true) return null;
        return new XMLParser({
          preserveOrder: true,
          ignoreAttributes: true,
          trimValues: false,
          parseTagValue: false,
          processEntities: true,
        }).parse(xml) as unknown;
      },
      catch: () => failure("invalid-document", "The DOCX document XML could not be read."),
    });
    if (tree === null)
      return yield* Effect.fail(failure("invalid-document", "The DOCX document XML is malformed."));
    const roots = yield* Schema.decodeUnknown(XmlNodes)(tree).pipe(
      Effect.mapError(() => failure("invalid-document", "The DOCX document structure is invalid.")),
    );
    const documentNodes = yield* Schema.decodeUnknown(XmlNodes)(xmlElement(roots, "document")).pipe(
      Effect.mapError(() => failure("invalid-document", "The DOCX main document is missing.")),
    );
    const body = yield* Schema.decodeUnknown(XmlNodes)(xmlElement(documentNodes, "body")).pipe(
      Effect.mapError(() => failure("invalid-document", "The DOCX document body is missing.")),
    );
    const pieces: string[] = [];
    const treeBounds = { visited: 0, invalid: false };
    const walk = (node: unknown, depth: number, inText = false): void => {
      treeBounds.visited += 1;
      if (depth > 100 || treeBounds.visited > 500_000) {
        treeBounds.invalid = true;
        return;
      }
      if (Array.isArray(node)) {
        for (const child of node) walk(child, depth + 1, inText);
        return;
      }
      if (typeof node !== "object" || node === null) return;
      for (const [name, children] of Object.entries(node)) {
        const tag = name.split(":").at(-1);
        if (name === "#text" && inText && typeof children === "string") pieces.push(children);
        else if (tag === "tab") pieces.push("\t");
        else if (tag === "br" || tag === "cr") pieces.push("\n");
        else {
          walk(children, depth + 1, tag === "t");
          if (tag === "p") pieces.push("\n\n");
          if (tag === "tc") pieces.push("\t");
        }
      }
    };
    walk(body, 0);
    if (treeBounds.invalid)
      return yield* Effect.fail(
        failure(
          "too-large",
          "The DOCX structure is too complex. Import a simpler export or paste its text.",
        ),
      );
    return pieces.join("");
  });
}

const PdfTextSchema = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      str: Schema.optional(Schema.String),
      hasEOL: Schema.optional(Schema.Boolean),
    }),
  ),
});
/** Vendor parser is bundled locally, without remote workers, fonts, URLs or file upload. */
function pdfSections(
  bytes: Uint8Array,
): Effect.Effect<ExtractedStudyMaterial, StudyMaterialExtractionFailure> {
  return Effect.gen(function* () {
    const module = yield* Effect.tryPromise({
      try: () => import("unpdf/pdfjs"),
      catch: () =>
        failure(
          "extraction-failed",
          "PDF extraction is unavailable in this runtime. Paste extracted text instead.",
        ),
    });
    const loading = yield* Effect.try({
      try: () =>
        module.getDocument({
          data: new Uint8Array(bytes),
          useWorkerFetch: false,
          useSystemFonts: false,
          disableFontFace: true,
          disableAutoFetch: true,
          disableStream: true,
          enableXfa: false,
          verbosity: 0,
        }),
      catch: () =>
        failure(
          "extraction-failed",
          "PDF extraction could not start in this runtime. Paste extracted text instead.",
        ),
    });
    const operation = Effect.gen(function* () {
      const document = yield* Effect.tryPromise({
        try: () => loading.promise,
        catch: (error) =>
          typeof error === "object" &&
          error !== null &&
          "name" in error &&
          error.name === "PasswordException"
            ? failure(
                "encrypted-pdf",
                "Password-protected PDFs are unsupported. Import an unlocked copy or paste its text.",
              )
            : failure(
                "invalid-document",
                "This PDF could not be read. Import a valid text-based PDF or paste its text.",
              ),
      });
      if (document.numPages > maxSections)
        return yield* Effect.fail(
          failure("too-large", "Import a PDF of at most 500 pages or split the document."),
        );
      const sections: Section[] = [];
      const warnings = [
        "PDF reading order, tables, formulas and code indentation may need correction. Review the extracted text before generating cards.",
      ];
      let total = 0;
      for (let number = 1; number <= document.numPages; number += 1) {
        const page = yield* Effect.tryPromise({
          try: () => document.getPage(number),
          catch: () =>
            failure("extraction-failed", `PDF page ${String(number)} could not be read.`),
        });
        const raw: unknown = yield* Effect.tryPromise({
          try: () => page.getTextContent(),
          catch: () =>
            failure("extraction-failed", `PDF page ${String(number)} text could not be extracted.`),
        });
        const content = yield* Schema.decodeUnknown(PdfTextSchema)(raw).pipe(
          Effect.mapError(() =>
            failure("invalid-document", "PDF text data could not be validated."),
          ),
        );
        const text = content.items
          .map((item) => (item.str === undefined ? "" : item.str + (item.hasEOL ? "\n" : " ")))
          .join("");
        total += text.length;
        if (total > maxTextCharacters)
          return yield* Effect.fail(
            failure("too-large", "The extracted PDF text is too large. Import a smaller document."),
          );
        if (!text.trim())
          warnings.push(
            `Page ${String(number)} has no readable text; images and scanned pages require OCR.`,
          );
        else sections.push(...splitText(text, `Page ${String(number)}`, number));
        yield* Effect.try({
          try: () => page.cleanup(),
          catch: () => failure("extraction-failed", "PDF page cleanup failed."),
        }).pipe(Effect.ignore);
      }
      return yield* checked({ format: "pdf", sections, warnings });
    });
    return yield* operation.pipe(
      Effect.timeoutFail({
        duration: "45 seconds",
        onTimeout: () =>
          failure(
            "extraction-failed",
            "PDF extraction timed out. Import a smaller PDF or paste its text.",
          ),
      }),
      Effect.ensuring(
        Effect.tryPromise({
          try: () => loading.destroy(),
          catch: () => failure("extraction-failed", "PDF cleanup failed."),
        }).pipe(Effect.ignore),
      ),
    );
  });
}

export function extractStudyMaterial(
  name: string,
  bytes: Uint8Array,
): Effect.Effect<ExtractedStudyMaterial, StudyMaterialExtractionFailure> {
  return Effect.suspend(() => {
    if (bytes.byteLength > MAX_STUDY_FILE_BYTES)
      return Effect.fail(failure("too-large", "Import files of at most 16 MiB."));
    const extension = name.toLowerCase().split(".").at(-1);
    if (extension === "pdf") return pdfSections(bytes);
    if (extension === "docx")
      return docxText(bytes).pipe(
        Effect.flatMap((text) =>
          checked({
            format: "docx",
            sections: splitText(text, "Document text", null),
            warnings: [
              "Only document-body text is extracted. Images, equations, comments, headers, footnotes and page layout are not preserved; check tables and code indentation.",
            ],
          }),
        ),
      );
    if (extension !== "txt" && extension !== "md" && extension !== "markdown")
      return Effect.fail(
        failure(
          "unsupported-format",
          "Use TXT, Markdown, DOCX or a text-based PDF. Legacy DOC files need conversion to DOCX.",
        ),
      );
    return decodeText(bytes).pipe(
      Effect.flatMap((text) =>
        checked({
          format: extension === "txt" ? "txt" : "markdown",
          sections: splitText(text, name.slice(0, 170) || "Text", null),
          warnings: [],
        }),
      ),
    );
  });
}
