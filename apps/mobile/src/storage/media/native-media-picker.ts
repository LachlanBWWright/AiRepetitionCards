import { Effect, Either, Schema } from "effect";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { verifyMediaAsset } from "@recall/application";
import { MediaMimeTypeSchema, MediaReferenceSchema } from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";

const maxMediaBytes = 20_000_000;
const supportedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
];

export type NativeMediaPickerFailure = {
  readonly _tag: "NativeMediaPickerFailure";
  readonly reason:
    | "picker-failed"
    | "file-unavailable"
    | "unsupported-type"
    | "invalid-size"
    | "read-failed"
    | "hash-failed"
    | "invalid-content";
  readonly message: string;
};

const failure = (
  reason: NativeMediaPickerFailure["reason"],
  message: string,
): NativeMediaPickerFailure => ({ _tag: "NativeMediaPickerFailure", reason, message });

/** Returns a verified attachment draft; the app commits bytes and card content together. */
export function pickNativeMedia(): Effect.Effect<
  StoredMediaAsset | null,
  NativeMediaPickerFailure
> {
  return Effect.gen(function* () {
    const selected = yield* Effect.tryPromise({
      try: () =>
        DocumentPicker.getDocumentAsync({
          type: supportedMimeTypes,
          copyToCacheDirectory: true,
          multiple: false,
        }),
      catch: () => failure("picker-failed", "The attachment picker could not open. Try again."),
    });
    if (selected.canceled) return null;
    const asset = selected.assets[0];
    if (!asset)
      return yield* Effect.fail(
        failure("file-unavailable", "The selected attachment is unavailable. Choose it again."),
      );
    const mimeType = Schema.decodeUnknownEither(MediaMimeTypeSchema)(asset.mimeType);
    if (Either.isLeft(mimeType))
      return yield* Effect.fail(
        failure("unsupported-type", "Choose a JPEG, PNG, GIF, WebP, MP3, OGG or WAV attachment."),
      );
    if (
      asset.size !== undefined &&
      (!Number.isInteger(asset.size) || asset.size <= 0 || asset.size > maxMediaBytes)
    ) {
      return yield* Effect.fail(
        failure("invalid-size", "Choose a nonempty attachment of at most 20 MB."),
      );
    }
    const metadata = yield* Effect.try({
      try: () => {
        const file = new File(asset.uri);
        return { file, exists: file.exists, size: file.size };
      },
      catch: () =>
        failure(
          "file-unavailable",
          "The selected attachment could not be opened. Choose it again.",
        ),
    });
    if (!metadata.exists)
      return yield* Effect.fail(
        failure("file-unavailable", "The selected attachment is unavailable. Choose it again."),
      );
    if (!Number.isInteger(metadata.size) || metadata.size <= 0 || metadata.size > maxMediaBytes) {
      return yield* Effect.fail(
        failure("invalid-size", "Choose a nonempty attachment of at most 20 MB."),
      );
    }
    const bytes = yield* Effect.tryPromise({
      try: () => metadata.file.bytes(),
      catch: () => failure("read-failed", "The attachment could not be read. Choose it again."),
    });
    if (bytes.byteLength !== metadata.size || bytes.byteLength > maxMediaBytes) {
      return yield* Effect.fail(
        failure(
          "invalid-size",
          "The attachment changed while being read. Choose it again, keeping it at most 20 MB.",
        ),
      );
    }
    const digest = yield* Effect.tryPromise({
      try: () => Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes)),
      catch: () => failure("hash-failed", "The attachment could not be verified. Try again."),
    });
    const id = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const reference = yield* Schema.decodeUnknown(MediaReferenceSchema)({
      id,
      mimeType: mimeType.right,
      byteLength: bytes.byteLength,
    }).pipe(
      Effect.mapError(() =>
        failure("invalid-content", "The attachment could not be validated. Choose another file."),
      ),
    );
    const stored: StoredMediaAsset = { reference, bytes };
    const verified = yield* Effect.try({
      try: () => verifyMediaAsset(stored),
      catch: () => failure("hash-failed", "The attachment could not be verified. Try again."),
    });
    if (!verified)
      return yield* Effect.fail(
        failure(
          "invalid-content",
          "The attachment's content does not match its image or audio type. Choose another file.",
        ),
      );
    return stored;
  });
}
