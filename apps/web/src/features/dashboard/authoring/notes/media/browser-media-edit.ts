import { Effect, Either, Schema } from "effect";
import { inspectEditableMedia } from "./media-edit-inspection";
import { encodeWave } from "./audio-wave";

const Percent = Schema.Number.pipe(Schema.finite(), Schema.between(0, 100));
export const ImageEditSchema = Schema.Struct({
  left: Percent,
  top: Percent,
  width: Percent.pipe(Schema.positive()),
  height: Percent.pipe(Schema.positive()),
  maxWidth: Schema.Number.pipe(Schema.int(), Schema.between(16, 4096)),
}).pipe(
  Schema.filter((value) => value.left + value.width <= 100 && value.top + value.height <= 100),
);
export const AudioEditSchema = Schema.Struct({
  start: Schema.Number.pipe(Schema.finite(), Schema.nonNegative()),
  end: Schema.Number.pipe(Schema.finite(), Schema.positive()),
}).pipe(Schema.filter((value) => value.end > value.start));
const failure = () => ({
  message: "The media could not be edited. Try a supported file or a smaller selection.",
});

export function cropImage(file: File, input: unknown) {
  if (file.size < 1 || file.size > 20_000_000)
    return Effect.fail({ message: "Choose a file smaller than 20 MB." });
  const parsed = Schema.decodeUnknownEither(ImageEditSchema)(input);
  if (Either.isLeft(parsed))
    return Effect.fail({
      message: "Choose a crop within the image and a width from 16 to 4096 pixels.",
    });
  const edit = parsed.right;
  return inspectMediaFile(file).pipe(
    Effect.flatMap((info) => {
      if (info?.kind !== "image")
        return Effect.fail({
          message: "This image cannot be safely previewed or edited. Attach the original instead.",
        });
      return Effect.tryPromise({
        try: async () => {
          const bitmap = await createImageBitmap(file);
          try {
            const sourceWidth = (bitmap.width * edit.width) / 100;
            const sourceHeight = (bitmap.height * edit.height) / 100;
            const width = Math.max(1, Math.round(Math.min(sourceWidth, edit.maxWidth)));
            const height = Math.max(1, Math.round((sourceHeight * width) / sourceWidth));
            if (!Number.isFinite(height) || height > 8192) return null;
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            if (!context) return null;
            context.drawImage(
              bitmap,
              (bitmap.width * edit.left) / 100,
              (bitmap.height * edit.top) / 100,
              sourceWidth,
              sourceHeight,
              0,
              0,
              canvas.width,
              canvas.height,
            );
            const blob = await new Promise<Blob | null>((resolve) => {
              canvas.toBlob(resolve, "image/png");
            });
            return blob && blob.size <= 20_000_000
              ? new File([blob], "edited-image.png", { type: "image/png" })
              : null;
          } finally {
            bitmap.close();
          }
        },
        catch: failure,
      }).pipe(
        Effect.flatMap((result) => (result ? Effect.succeed(result) : Effect.fail(failure()))),
      );
    }),
  );
}

export function trimAudio(file: File, input: unknown) {
  if (file.size < 1 || file.size > 20_000_000)
    return Effect.fail({ message: "Choose a file smaller than 20 MB." });
  const parsed = Schema.decodeUnknownEither(AudioEditSchema)(input);
  if (Either.isLeft(parsed))
    return Effect.fail({ message: "Choose an end time greater than the start time." });
  const edit = parsed.right;
  return inspectMediaFile(file).pipe(
    Effect.flatMap((info) => {
      if (info?.kind !== "audio")
        return Effect.fail({
          message:
            "Trimming supports PCM WAV up to 5 minutes, 2 channels, and 96 kHz. Attach the original instead.",
        });
      return Effect.tryPromise({
        try: async () => {
          const context = new AudioContext({ sampleRate: info.sampleRate });
          try {
            const decoded = await context.decodeAudioData(await file.arrayBuffer());
            const start = Math.floor(edit.start * decoded.sampleRate);
            const end = Math.min(decoded.length, Math.floor(edit.end * decoded.sampleRate));
            if (
              edit.end > decoded.duration + 0.01 ||
              end <= start ||
              (end - start) * decoded.numberOfChannels * 2 + 44 > 20_000_000
            )
              return null;
            const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) =>
              decoded.getChannelData(index),
            );
            const bytes = encodeWave(channels, decoded.sampleRate, start, end);
            return new File([new Uint8Array(bytes)], "trimmed-audio.wav", { type: "audio/wav" });
          } finally {
            await context.close();
          }
        },
        catch: failure,
      }).pipe(
        Effect.flatMap((result) => (result ? Effect.succeed(result) : Effect.fail(failure()))),
      );
    }),
  );
}

export function inspectMediaFile(file: File) {
  if (file.size < 1 || file.size > 20_000_000) return Effect.succeed(undefined);
  return Effect.tryPromise({
    try: () => file.arrayBuffer(),
    catch: failure,
  }).pipe(Effect.map((buffer) => inspectEditableMedia(new Uint8Array(buffer), file.type)));
}
