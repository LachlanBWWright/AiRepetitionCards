import { Schema } from "effect";
import { AreaIdSchema, KnowledgeAreaSchema } from "@recall/domain";

const UuidSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);

export const PublicationVersionIdSchema = UuidSchema.pipe(Schema.brand("PublicationVersionId"));
export const PublicationVisibilitySchema = Schema.Union(
  Schema.Literal("private"),
  Schema.Literal("unlisted"),
  Schema.Literal("public"),
);

const AttributionSchema = Schema.NullOr(Schema.String.pipe(Schema.maxLength(500)));
const LicenseSchema = Schema.NullOr(Schema.String.pipe(Schema.maxLength(120)));
const HashSchema = Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/i));
const TimestampSchema = Schema.String.pipe(
  Schema.maxLength(40),
  Schema.pattern(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/),
);

export const PublishKnowledgeAreaRequestSchema = Schema.Struct({
  sourceAreaId: AreaIdSchema,
  content: KnowledgeAreaSchema,
  visibility: PublicationVisibilitySchema,
  attribution: Schema.optional(AttributionSchema),
  license: Schema.optional(LicenseSchema),
  forkedFromVersionId: Schema.optional(Schema.NullOr(PublicationVersionIdSchema)),
});

export const PublishedKnowledgeAreaVersionSchema = Schema.Struct({
  id: PublicationVersionIdSchema,
  sourceAreaId: Schema.optional(Schema.NullOr(AreaIdSchema)),
  version: Schema.Number.pipe(Schema.int(), Schema.positive()),
  content: KnowledgeAreaSchema,
  contentHash: HashSchema,
  visibility: Schema.optional(PublicationVisibilitySchema),
  attribution: AttributionSchema,
  license: LicenseSchema,
  forkedFromVersionId: Schema.NullOr(PublicationVersionIdSchema),
  createdAt: TimestampSchema,
});

export const PublishKnowledgeAreaResponseSchema = Schema.Struct({
  version: PublishedKnowledgeAreaVersionSchema,
  shareToken: Schema.optional(Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{43}$/))),
});

export const ReadPublishedKnowledgeAreaResponseSchema = Schema.Struct({
  version: Schema.Struct({
    id: PublicationVersionIdSchema,
    version: Schema.Number.pipe(Schema.int(), Schema.positive()),
    content: KnowledgeAreaSchema,
    contentHash: HashSchema,
    attribution: AttributionSchema,
    license: LicenseSchema,
    forkedFromVersionId: Schema.NullOr(PublicationVersionIdSchema),
    createdAt: TimestampSchema,
  }),
});

export const ForkPublishedKnowledgeAreaRequestSchema = Schema.Struct({
  shareToken: Schema.optional(Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{43}$/))),
});

export const ForkPublishedKnowledgeAreaResponseSchema = Schema.Struct({
  document: KnowledgeAreaSchema,
  attribution: AttributionSchema,
  license: LicenseSchema,
  forkedFromVersionId: PublicationVersionIdSchema,
});

export type PublishKnowledgeAreaRequest = typeof PublishKnowledgeAreaRequestSchema.Type;
export type PublishKnowledgeAreaResponse = typeof PublishKnowledgeAreaResponseSchema.Type;
export type ReadPublishedKnowledgeAreaResponse =
  typeof ReadPublishedKnowledgeAreaResponseSchema.Type;
export type ForkPublishedKnowledgeAreaRequest = typeof ForkPublishedKnowledgeAreaRequestSchema.Type;
export type ForkPublishedKnowledgeAreaResponse =
  typeof ForkPublishedKnowledgeAreaResponseSchema.Type;
