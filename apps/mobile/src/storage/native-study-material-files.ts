import { Effect } from "effect";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { MAX_STUDY_FILE_BYTES } from "@recall/infra-study-materials";

const maximumBytes = MAX_STUDY_FILE_BYTES;
export type NativeStudyFileFailure = {
  readonly _tag: "NativeStudyFileFailure";
  readonly message: string;
};

/** Delete the picker cache copy after reading; the notebook stores extracted text only. */
export function pickNativeStudyFile(
  ocr = false,
): Effect.Effect<
  { readonly name: string; readonly bytes: Uint8Array } | null,
  NativeStudyFileFailure
> {
  return Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () =>
        DocumentPicker.getDocumentAsync({
          type: ocr
            ? ["application/pdf", "image/png", "image/jpeg"]
            : [
                "text/plain",
                "text/markdown",
                "application/pdf",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/octet-stream",
              ],
          copyToCacheDirectory: true,
          multiple: false,
        }),
      catch: () =>
        ({
          _tag: "NativeStudyFileFailure",
          message: "The document picker could not be opened.",
        }) as const,
    });
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset)
      return yield* Effect.fail({
        _tag: "NativeStudyFileFailure",
        message: "The selected document is unavailable.",
      } as const);
    const cleanupState: { failure: NativeStudyFileFailure | null } = { failure: null };
    const cleanup = Effect.try({
      try: () => {
        const cachePrefix = `${Paths.cache.uri.replace(/\/$/, "")}/`;
        // The picker requested a cache copy. Never remove a path outside that cache.
        if (!asset.uri.startsWith(cachePrefix)) return;
        const file = new File(asset.uri);
        if (file.exists) file.delete();
      },
      catch: () =>
        ({
          _tag: "NativeStudyFileFailure",
          message:
            "The temporary document copy could not be deleted from the app cache. Remove it using device storage settings.",
        }) as const,
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          cleanupState.failure = error;
        }),
      ),
    );
    const read = Effect.gen(function* () {
      if (asset.size !== undefined && asset.size > maximumBytes)
        return yield* Effect.fail({
          _tag: "NativeStudyFileFailure",
          message: "Choose a document smaller than 16 MiB.",
        } as const);
      const bytes = yield* Effect.tryPromise({
        try: async () => {
          const file = new File(asset.uri);
          return file.size > maximumBytes ? null : await file.bytes();
        },
        catch: () =>
          ({
            _tag: "NativeStudyFileFailure",
            message: "The document could not be read on this device.",
          }) as const,
      });
      if (!bytes || bytes.length > maximumBytes)
        return yield* Effect.fail({
          _tag: "NativeStudyFileFailure",
          message: "Choose a document smaller than 16 MiB.",
        } as const);
      return { name: asset.name, bytes };
    });
    const outcome = yield* Effect.either(read.pipe(Effect.ensuring(cleanup)));
    if (cleanupState.failure) return yield* Effect.fail(cleanupState.failure);
    return yield* outcome;
  });
}
