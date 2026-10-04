import { extractPastedStudyText, extractStudyMaterial } from "@recall/infra-study-materials";
import { Effect } from "effect";

type Extraction = Effect.Effect.Success<ReturnType<typeof extractStudyMaterial>>;
type ExtractionFailure = Effect.Effect.Error<ReturnType<typeof extractStudyMaterial>>;

/** Keep every saved native excerpt within the provider's source limit. */
function prepareExcerpts(extraction: Extraction): Extraction {
  return {
    ...extraction,
    sections: extraction.sections.flatMap((section) => {
      const excerpts: Extraction["sections"][number][] = [];
      let offset = 0;
      while (offset < section.text.length) {
        let end = Math.min(offset + 12000, section.text.length);
        const last = section.text.charCodeAt(end - 1);
        if (end < section.text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
        const text = section.text.slice(offset, end).trim();
        if (text)
          excerpts.push({
            ...section,
            text,
            title: (
              section.title +
              (section.text.length > 12000 ? ` · part ${String(excerpts.length + 1)}` : "")
            ).slice(0, 200),
          });
        offset = end;
      }
      return excerpts;
    }),
  };
}

function checkedExcerpts(extraction: Extraction): Effect.Effect<Extraction, ExtractionFailure> {
  const prepared = prepareExcerpts(extraction);
  return prepared.sections.length <= 500
    ? Effect.succeed(prepared)
    : Effect.fail({
        _tag: "StudyMaterialExtractionFailure",
        reason: "too-large",
        message:
          "This document needs more than 500 AI-sized excerpts. Import a smaller document or paste selected chapters.",
      });
}

/** Shared local parsing; platform/vendor failures stay in the infrastructure adapter. */
export const extractNativeStudyFile = (name: string, bytes: Uint8Array) =>
  extractStudyMaterial(name, bytes).pipe(Effect.flatMap(checkedExcerpts));
export const extractNativeStudyPaste = (text: string) =>
  extractPastedStudyText("Study notes", text).pipe(Effect.flatMap(checkedExcerpts));
