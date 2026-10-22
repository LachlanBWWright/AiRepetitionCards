import { Effect, Either, Schema } from "effect";
import { sha256 } from "@noble/hashes/sha2.js";
import { MediaReferenceSchema } from "@recall/domain";
import { validateNoteAttachment } from "@recall/application";

export function readNoteMediaFile(file: File) {
  if (file.size < 1 || file.size > 20_000_000)
    return Effect.fail({ message: "Choose an image or audio file smaller than 20 MB." });
  return Effect.tryPromise({
    try: () => file.arrayBuffer(),
    catch: () => ({ message: "The attachment could not be read. Choose it again." }),
  }).pipe(
    Effect.flatMap((buffer) => {
      const bytes = new Uint8Array(buffer);
      const id = Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const reference = Schema.decodeUnknownEither(MediaReferenceSchema)({
        id,
        mimeType: file.type,
        byteLength: bytes.byteLength,
      });
      return Either.isLeft(reference)
        ? Effect.fail({ message: "Choose a supported image or audio file smaller than 20 MB." })
        : validateNoteAttachment({ reference: reference.right, bytes });
    }),
  );
}
