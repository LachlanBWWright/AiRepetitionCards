import { Effect, Either, Schema } from "effect";
import { MediaReferenceSchema } from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";
import { isSupportedMediaContent } from "../interchange/knowledge-area-package";

export function validateNoteAttachment(asset: StoredMediaAsset) {
  const reference = Schema.decodeUnknownEither(MediaReferenceSchema)(asset.reference);
  return Either.isLeft(reference) ||
    asset.bytes.byteLength !== asset.reference.byteLength ||
    !isSupportedMediaContent(asset.bytes, asset.reference.mimeType)
    ? Effect.fail({ message: "Choose a supported image or audio attachment smaller than 20 MB." })
    : Effect.succeed(asset);
}
