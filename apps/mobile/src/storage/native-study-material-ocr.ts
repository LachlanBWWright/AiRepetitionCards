import { Effect, Schema } from "effect";
import { requireOptionalNativeModule } from "expo";
import { File, Paths } from "expo-file-system";
import { extractPastedStudyText } from "@recall/infra-study-materials";
import { extractNativeStudyPaste } from "./native-study-material-extraction";

type NativeOcrModule = {
  readonly recognize: (uri: string, kind: string, first: number, last: number) => Promise<unknown>;
};
export type NativeOcrFailure = {
  readonly _tag: "NativeOcrFailure";
  readonly message: string;
};
const ResultSchema = Schema.Union(
  Schema.Struct({ ok: Schema.Literal(false), code: Schema.String }),
  Schema.Struct({
    ok: Schema.Literal(true),
    pageCount: Schema.Int.pipe(Schema.between(1, 100000)),
    pages: Schema.Array(
      Schema.Struct({
        pageNumber: Schema.Int.pipe(Schema.between(1, 100000)),
        text: Schema.String.pipe(Schema.maxLength(2000000)),
      }),
    ).pipe(Schema.minItems(1), Schema.maxItems(20)),
  }),
);
const fail = (message: string): NativeOcrFailure => ({ _tag: "NativeOcrFailure", message });

/** Native recognition stays offline; only the corrected text enters the notebook. */
export function extractNativeOcr(
  name: string,
  bytes: Uint8Array,
  firstPage = 1,
  lastPage = 1,
): Effect.Effect<
  Effect.Effect.Success<ReturnType<typeof extractPastedStudyText>>,
  NativeOcrFailure
> {
  return Effect.gen(function* () {
    const extension = name.toLowerCase().split(".").pop();
    const kind =
      extension === "pdf"
        ? "pdf"
        : ["png", "jpg", "jpeg"].includes(extension ?? "")
          ? "image"
          : null;
    if (!kind) return yield* Effect.fail(fail("OCR supports PDF, PNG and JPEG files."));
    if (bytes.length === 0 || bytes.length > 16 * 1024 * 1024)
      return yield* Effect.fail(fail("Choose a nonempty file smaller than 16 MiB."));
    if (
      !Number.isInteger(firstPage) ||
      !Number.isInteger(lastPage) ||
      firstPage < 1 ||
      lastPage < firstPage ||
      lastPage - firstPage >= 20
    )
      return yield* Effect.fail(fail("Choose a range of 1–20 pages, starting at page 1 or later."));
    const native = yield* Effect.try({
      try: () => requireOptionalNativeModule<NativeOcrModule>("RecallOcr"),
      catch: () =>
        fail("On-device OCR is unavailable in this build. Install a native application build."),
    });
    if (!native)
      return yield* Effect.fail(
        fail("On-device OCR requires a native application build; Expo Go is unsupported."),
      );
    const temporary = yield* Effect.try({
      try: () => {
        const file = new File(
          Paths.cache,
          `study-ocr-${String(Date.now())}-${Math.random().toString(36).slice(2)}.${kind === "pdf" ? "pdf" : extension}`,
        );
        file.create();
        return file;
      },
      catch: () => fail("A temporary local OCR file could not be created."),
    });
    const cleanupState: { failure: NativeOcrFailure | null } = { failure: null };
    const cleanup = Effect.try({
      try: () => {
        if (temporary.exists) temporary.delete();
      },
      catch: () =>
        fail(
          "The temporary OCR copy could not be deleted. Remove the app cache using device storage settings.",
        ),
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          cleanupState.failure = error;
        }),
      ),
    );
    const operation = Effect.gen(function* () {
      yield* Effect.try({
        try: () => temporary.write(bytes),
        catch: () => fail("The temporary OCR file could not be written."),
      });
      const raw = yield* Effect.tryPromise({
        try: () =>
          native.recognize(
            temporary.uri,
            kind,
            kind === "image" ? 1 : firstPage,
            kind === "image" ? 1 : lastPage,
          ),
        catch: () =>
          fail(
            "On-device recognition could not finish. Try a smaller page range or a clearer image.",
          ),
      });
      const result = yield* Schema.decodeUnknown(ResultSchema)(raw).pipe(
        Effect.mapError(() => fail("The OCR engine returned invalid output.")),
      );
      if (!result.ok)
        return yield* Effect.fail(
          fail(
            result.code === "page-range"
              ? "The selected page range is outside this document. Choose at most 20 existing pages."
              : result.code === "encrypted-pdf" || result.code === "encrypted-or-inaccessible"
                ? "Unlock the PDF before importing it for OCR."
                : "Recognition could not finish. Check the file and try a smaller page range or a clearer image.",
          ),
        );
      const sections: Effect.Effect.Success<
        ReturnType<typeof extractPastedStudyText>
      >["sections"][number][] = [];
      let total = 0;
      for (const page of result.pages) {
        if (!page.text.trim()) continue;
        total += page.text.length;
        if (total > 2000000)
          return yield* Effect.fail(fail("OCR output is too large. Import fewer pages."));
        const prepared = yield* extractNativeStudyPaste(page.text).pipe(
          Effect.mapError((error) => fail(error.message)),
        );
        sections.push(
          ...prepared.sections.map((section) => ({
            ...section,
            title: `OCR · page ${String(page.pageNumber)}`,
            pageNumber: kind === "pdf" ? page.pageNumber : null,
          })),
        );
      }
      if (!sections.length)
        return yield* Effect.fail(
          fail("No readable text was recognized. Try a clearer, upright image."),
        );
      if (sections.length > 500)
        return yield* Effect.fail(fail("OCR produced too many excerpts. Import fewer pages."));
      return {
        format: kind === "pdf" ? ("pdf" as const) : ("image" as const),
        sections,
        warnings: [
          "On-device OCR targets English and Latin script. Check spelling, reading order, formulas and code before generating cards.",
          ...(kind === "pdf"
            ? [
                `OCR includes pages ${String(firstPage)}–${String(lastPage)} of ${String(result.pageCount)}. Other pages were not imported.`,
              ]
            : []),
          ...(result.pages.some((page) => !page.text.trim())
            ? ["Some selected pages had no recognized text."]
            : []),
        ],
      };
    });
    const outcome = yield* Effect.either(operation.pipe(Effect.ensuring(cleanup)));
    if (cleanupState.failure) return yield* Effect.fail(cleanupState.failure);
    return yield* outcome;
  });
}
