import { Effect, Schema } from "effect";
import { unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { StudyMaterialExtractionFailure } from "./index";

type Failure = (
  reason: StudyMaterialExtractionFailure["reason"],
  message: string,
) => StudyMaterialExtractionFailure;
type TextDecoder = (bytes: Uint8Array) => Effect.Effect<string, StudyMaterialExtractionFailure>;
const XmlNodes = Schema.Array(Schema.Record({ key: Schema.String, value: Schema.Unknown }));

function xmlElement(nodes: typeof XmlNodes.Type, localName: string): unknown {
  return nodes
    .flatMap((node) => Object.entries(node))
    .find(([name]) => name.split(":").at(-1) === localName)?.[1];
}

export function decodeDocxText(
  bytes: Uint8Array,
  decodeText: TextDecoder,
  failure: Failure,
): Effect.Effect<string, StudyMaterialExtractionFailure> {
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
    if (XMLValidator.validate(xml) !== true)
      return yield* Effect.fail(failure("invalid-document", "The DOCX document XML is malformed."));
    const tree: unknown = yield* Effect.try({
      try: (): unknown => {
        return new XMLParser({
          preserveOrder: true,
          ignoreAttributes: true,
          trimValues: false,
          parseTagValue: false,
          processEntities: true,
          htmlEntities: true,
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
