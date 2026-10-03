import { Schema } from "effect";
import { MediaIdSchema, MediaReferenceSchema } from "@recall/domain";
import { PublicationVersionIdSchema } from "./publishing";

export const PublishedMediaUploadResponseSchema = Schema.Struct({
  schemaVersion: Schema.optional(Schema.Literal(1)),
  reference: MediaReferenceSchema,
});

/** Validates a media route ID together with the caller-provided media reference. */
export const MediaReferenceRouteRequestSchema = Schema.Struct({
  mediaId: MediaIdSchema,
  reference: MediaReferenceSchema,
});

export const PublishedMediaReadRequestSchema = Schema.Struct({
  token: Schema.optional(Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{43}$/))),
});

/** Decodes all values for a token query key; multiple values fail the single-token contract. */
export const PublishedShareTokenQuerySchema = PublishedMediaReadRequestSchema;

export const PublishedMediaRouteRequestSchema = Schema.Struct({
  versionId: PublicationVersionIdSchema,
  mediaId: MediaIdSchema,
  token: Schema.optional(Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{43}$/))),
});

export type PublishedMediaUploadResponse = typeof PublishedMediaUploadResponseSchema.Type;
export type MediaReferenceRouteRequest = typeof MediaReferenceRouteRequestSchema.Type;
export type PublishedMediaReadRequest = typeof PublishedMediaReadRequestSchema.Type;
export type PublishedMediaRouteRequest = typeof PublishedMediaRouteRequestSchema.Type;
