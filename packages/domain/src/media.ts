import { Schema } from "effect";
import { MediaIdSchema } from "./ids";

export const MediaMimeTypeSchema = Schema.Union(
  Schema.Literal("image/jpeg"),
  Schema.Literal("image/png"),
  Schema.Literal("image/gif"),
  Schema.Literal("image/webp"),
  Schema.Literal("audio/mpeg"),
  Schema.Literal("audio/ogg"),
  Schema.Literal("audio/wav"),
  Schema.Literal("audio/mp4"),
  Schema.Literal("audio/webm"),
);
export type MediaMimeType = typeof MediaMimeTypeSchema.Type;

export const MediaReferenceSchema = Schema.Struct({
  id: MediaIdSchema,
  mimeType: MediaMimeTypeSchema,
  byteLength: Schema.Number.pipe(
    Schema.int(),
    Schema.positive(),
    Schema.lessThanOrEqualTo(20_000_000),
  ),
});
export type MediaReference = typeof MediaReferenceSchema.Type;
