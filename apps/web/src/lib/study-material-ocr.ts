import { Effect, Schema } from "effect";
import {
  ExtractedStudyMaterialSchema,
  MAX_STUDY_FILE_BYTES,
  type ExtractedStudyMaterial,
} from "@recall/infra-study-materials";
import type { Worker } from "tesseract.js";

export type StudyOcrFailure = {
  readonly _tag: "StudyOcrFailure";
  readonly message: string;
};
export type StudyOcrProgress = {
  readonly page: number;
  readonly pages: number;
  readonly progress: number;
};
const failure = (message: string): StudyOcrFailure => ({ _tag: "StudyOcrFailure", message });
const OcrResult = Schema.Struct({
  data: Schema.Struct({ text: Schema.String, confidence: Schema.Number }),
});
const PdfText = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({ str: Schema.optional(Schema.String), hasEOL: Schema.optional(Schema.Boolean) }),
  ),
});
const maxPixels = 8_000_000;
const maxPages = 30;
const maxCharacters = 600_000;

function asset(path: string): string {
  const base =
    location.protocol === "file:" ? new URL("./", location.href) : new URL("/", location.href);
  return new URL(`vendor/ocr/${path}`, base).href;
}
function section(text: string, pageNumber: number | null): ExtractedStudyMaterial["sections"] {
  const result: ExtractedStudyMaterial["sections"][number][] = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + 12000, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    const value = text.slice(offset, end).trim();
    if (value)
      result.push({
        text: value,
        title: pageNumber === null ? "Image text" : `Page ${String(pageNumber)}`,
        pageNumber,
      });
    offset = end;
  }
  return result;
}
/** No uploaded content, CDN workers, fonts, or language downloads. Assets ship with the app. */
export function extractStudyMaterialWithOcr(
  name: string,
  bytes: Uint8Array,
  options: {
    readonly signal: AbortSignal;
    readonly onProgress: (progress: StudyOcrProgress) => void;
  },
): Effect.Effect<ExtractedStudyMaterial, StudyOcrFailure> {
  return Effect.gen(function* () {
    const pdf = name.toLowerCase().endsWith(".pdf");
    const image = /\.(png|jpe?g|webp)$/iu.test(name);
    if (!pdf && !image)
      return yield* Effect.fail(failure("OCR supports PDF, PNG, JPEG and WebP files."));
    if (!bytes.length || bytes.length > MAX_STUDY_FILE_BYTES)
      return yield* Effect.fail(failure("Choose a file of at most 16 MiB."));
    const canceled = () => options.signal.aborted;
    const check = () =>
      canceled() ? Effect.fail(failure("OCR canceled. No material was saved.")) : Effect.void;
    yield* check();
    const engine = yield* Effect.tryPromise({
      try: () => import("tesseract.js"),
      catch: () => failure("The local OCR engine could not be loaded."),
    });
    let worker: Worker | null = null;
    let pageNumber = 1;
    let pages = 1;
    const terminate = () => {
      void worker?.terminate().catch(() => undefined);
    };
    options.signal.addEventListener("abort", terminate, { once: true });
    const operation = Effect.gen(function* () {
      worker = yield* Effect.tryPromise({
        try: async (signal) => {
          const created = await engine.createWorker("eng", 1, {
            workerPath: asset("worker.min.js"),
            corePath: asset("core/"),
            langPath: asset("lang/"),
            workerBlobURL: false,
            cacheMethod: "none",
            gzip: true,
            // Vendor jobs reject their promises; prevent the duplicate uncaught callback error.
            errorHandler: () => undefined,
            logger: (message) =>
              options.onProgress({
                page: pageNumber,
                pages,
                progress: Math.min(1, Math.max(0, message.progress)),
              }),
          });
          if (signal.aborted || options.signal.aborted) await created.terminate();
          return created;
        },
        catch: () =>
          failure("Local OCR could not start. Ensure the app's OCR assets are installed."),
      });
      yield* check();
      const active = worker;
      const recognize = (canvas: HTMLCanvasElement) =>
        Effect.gen(function* () {
          yield* check();
          const raw: unknown = yield* Effect.tryPromise({
            try: () => active.recognize(canvas),
            catch: () =>
              failure(
                canceled()
                  ? "OCR canceled. No material was saved."
                  : "The image could not be read by OCR.",
              ),
          });
          return yield* Schema.decodeUnknown(OcrResult)(raw).pipe(
            Effect.mapError(() => failure("OCR returned invalid text data.")),
          );
        });
      const warnings = [
        "English OCR runs locally. Check spelling, reading order, tables, formulas and code before generating cards.",
      ];
      const sections: ExtractedStudyMaterial["sections"][number][] = [];
      let total = 0;
      if (image) {
        const bitmap = yield* Effect.tryPromise({
          try: () =>
            createImageBitmap(
              new Blob([new Uint8Array(bytes)], {
                type: name.toLowerCase().endsWith(".png")
                  ? "image/png"
                  : name.toLowerCase().endsWith(".webp")
                    ? "image/webp"
                    : "image/jpeg",
              }),
            ),
          catch: () => failure("This image could not be decoded."),
        });
        yield* Effect.gen(function* () {
          if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000)
            return yield* Effect.fail(failure("Choose an image smaller than 40 megapixels."));
          const scale = Math.min(
            1,
            Math.sqrt(maxPixels / (bitmap.width * bitmap.height)),
            4096 / Math.max(bitmap.width, bitmap.height),
          );
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
          canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
          const context = canvas.getContext("2d");
          if (!context)
            return yield* Effect.fail(failure("This device cannot render an image for OCR."));
          context.fillStyle = "white";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const result = yield* recognize(canvas);
          if (result.data.text.length > maxCharacters)
            return yield* Effect.fail(failure("OCR text is too large. Import a smaller image."));
          sections.push(...section(result.data.text, null));
          if (result.data.confidence < 75)
            warnings.push("OCR confidence is low; review and correct this image's extracted text.");
        }).pipe(Effect.ensuring(Effect.sync(() => bitmap.close())));
      } else {
        const pdfjs = yield* Effect.tryPromise({
          try: () => import("unpdf/pdfjs"),
          catch: () => failure("The local PDF renderer could not be loaded."),
        });
        const loading = yield* Effect.try({
          try: () =>
            pdfjs.getDocument({
              data: new Uint8Array(bytes),
              useWorkerFetch: false,
              useSystemFonts: false,
              disableFontFace: true,
              disableAutoFetch: true,
              disableStream: true,
              enableXfa: false,
              verbosity: 0,
            }),
          catch: () => failure("This PDF could not be opened for OCR."),
        });
        const cancelPdf = () => {
          void loading.destroy().catch(() => undefined);
        };
        options.signal.addEventListener("abort", cancelPdf, { once: true });
        yield* Effect.gen(function* () {
          const documentPdf = yield* Effect.tryPromise({
            try: () => loading.promise,
            catch: () =>
              failure("This PDF could not be read. Unlock encrypted documents before importing."),
          });
          pages = documentPdf.numPages;
          if (pages > maxPages)
            return yield* Effect.fail(
              failure("OCR supports at most 30 PDF pages per import. Split longer documents."),
            );
          for (pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
            yield* check();
            const page = yield* Effect.tryPromise({
              try: () => documentPdf.getPage(pageNumber),
              catch: () => failure("A PDF page could not be read."),
            });
            yield* Effect.gen(function* () {
              const raw: unknown = yield* Effect.tryPromise({
                try: () => page.getTextContent(),
                catch: () => failure("A PDF page's text could not be read."),
              });
              const content = yield* Schema.decodeUnknown(PdfText)(raw).pipe(
                Effect.mapError(() => failure("The PDF text could not be validated.")),
              );
              let text = content.items
                .map((item) => item.str ?? "")
                .join(" ")
                .trim();
              {
                const base = yield* Effect.try({
                  try: () => page.getViewport({ scale: 1 }),
                  catch: () => failure("A PDF page has invalid dimensions."),
                });
                if (
                  !Number.isFinite(base.width) ||
                  !Number.isFinite(base.height) ||
                  base.width <= 0 ||
                  base.height <= 0
                )
                  return yield* Effect.fail(failure("A PDF page has invalid dimensions."));
                const scale = Math.min(
                  2,
                  Math.sqrt(maxPixels / (base.width * base.height)),
                  4096 / Math.max(base.width, base.height),
                );
                const viewport = page.getViewport({ scale });
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.floor(viewport.width));
                canvas.height = Math.max(1, Math.floor(viewport.height));
                const context = canvas.getContext("2d");
                if (!context)
                  return yield* Effect.fail(
                    failure("This device cannot render PDF pages for OCR."),
                  );
                const render = yield* Effect.try({
                  try: () =>
                    page.render({ canvasContext: context, canvas, viewport, background: "white" }),
                  catch: () => failure("A PDF page could not be rendered for OCR."),
                });
                const cancelRender = () => render.cancel();
                options.signal.addEventListener("abort", cancelRender, { once: true });
                yield* Effect.tryPromise({
                  try: () => render.promise,
                  catch: () =>
                    failure(
                      canceled()
                        ? "OCR canceled. No material was saved."
                        : "A PDF page could not be rendered for OCR.",
                    ),
                }).pipe(
                  Effect.ensuring(
                    Effect.sync(() => options.signal.removeEventListener("abort", cancelRender)),
                  ),
                );
                const result = yield* recognize(canvas);
                if (result.data.text.trim()) text = result.data.text;
                canvas.width = 0;
                canvas.height = 0;
                if (result.data.confidence < 75)
                  warnings.push(
                    `Page ${String(pageNumber)} has low OCR confidence; check its extracted text.`,
                  );
              }
              total += text.length;
              if (total > maxCharacters)
                return yield* Effect.fail(failure("OCR text is too large. Import a smaller PDF."));
              sections.push(...section(text, pageNumber));
              if (!text.trim())
                warnings.push(`Page ${String(pageNumber)} has no readable text after OCR.`);
              options.onProgress({ page: pageNumber, pages, progress: 1 });
            }).pipe(
              Effect.ensuring(
                Effect.try({
                  try: () => page.cleanup(),
                  catch: () => failure("PDF cleanup failed."),
                }).pipe(Effect.ignore),
              ),
            );
          }
        }).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              options.signal.removeEventListener("abort", cancelPdf);
              yield* Effect.tryPromise({
                try: () => loading.destroy(),
                catch: () => failure("PDF cleanup failed."),
              }).pipe(Effect.ignore);
            }),
          ),
        );
      }
      yield* check();
      if (!sections.length)
        return yield* Effect.fail(
          failure("OCR found no readable text. Try a clearer image or paste corrected text."),
        );
      return yield* Schema.decodeUnknown(ExtractedStudyMaterialSchema)({
        format: pdf ? "pdf" : "image",
        sections,
        warnings,
      }).pipe(
        Effect.mapError(() => failure("The extracted text exceeds supported document limits.")),
      );
    });
    const cancellation = Effect.async<never, StudyOcrFailure>((resume) => {
      const abort = () => resume(Effect.fail(failure("OCR canceled. No material was saved.")));
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
      return Effect.sync(() => options.signal.removeEventListener("abort", abort));
    });
    return yield* operation.pipe(
      Effect.raceFirst(cancellation),
      Effect.timeoutFail({
        duration: "10 minutes",
        onTimeout: () => failure("OCR timed out. Try a smaller document."),
      }),
      Effect.ensuring(
        Effect.gen(function* () {
          options.signal.removeEventListener("abort", terminate);
          const current = worker;
          if (current)
            yield* Effect.tryPromise({
              try: () => current.terminate(),
              catch: () => failure("OCR cleanup failed."),
            }).pipe(Effect.ignore);
        }),
      ),
    );
  });
}
