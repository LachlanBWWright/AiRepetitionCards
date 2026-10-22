import { Effect, Schema } from "effect";
import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { MediaReferenceSchema } from "@recall/domain";
import { verifyMediaAsset } from "@recall/application";
import type { StoredMediaAsset } from "@recall/local-store";

type Failure = { readonly _tag: "RecordingFailure"; readonly message: string };
export function readNativeRecording(uri: string): Effect.Effect<StoredMediaAsset, Failure> {
  return Effect.gen(function* () {
    const bytes = yield* Effect.tryPromise({
      try: () => new File(uri).bytes(),
      catch: (): Failure => ({
        _tag: "RecordingFailure",
        message: "The recording could not be read.",
      }),
    });
    if (bytes.byteLength < 1 || bytes.byteLength > 20_000_000)
      return yield* Effect.fail({
        _tag: "RecordingFailure" as const,
        message: "Recordings must be nonempty and at most 20 MB.",
      });
    const digest = yield* Effect.tryPromise({
      try: () => Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes)),
      catch: (): Failure => ({
        _tag: "RecordingFailure",
        message: "The recording could not be verified.",
      }),
    });
    const id = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const reference = yield* Schema.decodeUnknown(MediaReferenceSchema)({
      id,
      mimeType: uri.includes(".webm") ? "audio/webm" : "audio/mp4",
      byteLength: bytes.byteLength,
    }).pipe(
      Effect.mapError((): Failure => ({
        _tag: "RecordingFailure",
        message: "Unsupported recording format.",
      })),
    );
    const asset = { reference, bytes };
    if (!verifyMediaAsset(asset))
      return yield* Effect.fail({
        _tag: "RecordingFailure" as const,
        message: "The recorded file did not pass audio validation.",
      });
    return asset;
  });
}
