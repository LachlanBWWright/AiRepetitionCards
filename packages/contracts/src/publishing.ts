import { normalizeReviewTimestamp } from "./review-timestamp";
import { Schema } from "effect";
import { AreaIdSchema, KnowledgeAreaSchema } from "@recall/domain";

const UuidSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);
const CanonicalUuidSchema = Schema.transform(UuidSchema, UuidSchema, {
  strict: true,
  decode: (value) => value.toLowerCase(),
  encode: (value) => value.toLowerCase(),
});

export const PublicationVersionIdSchema = CanonicalUuidSchema.pipe(
  Schema.brand("PublicationVersionId"),
);
export const PublicationForkOperationIdSchema = CanonicalUuidSchema.pipe(
  Schema.brand("PublicationForkOperationId"),
);
export const PublishedShareTokenSchema = Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{43}$/));
export const PublicationVisibilitySchema = Schema.Union(
  Schema.Literal("private"),
  Schema.Literal("unlisted"),
  Schema.Literal("public"),
);

/** /api/v1 accepts legacy bodies without the additive version discriminator. */
const PublishingSchemaVersion = Schema.optional(Schema.Literal(1));

export const PublishingErrorCodeSchema = Schema.Literal(
  "not-configured",
  "unauthenticated",
  "workspace-account-changed",
  "unavailable",
  "invalid-request",
  "request-too-large",
  "invalid-publication",
  "publication-not-found",
  "publication-unavailable",
  "publication-save-failed",
  "publication-response-invalid",
  "version-conflict",
  "area-not-found",
  "source-version-not-found",
  "source-version-invalid",
  "invalid-share-token",
  "fork-generation-failed",
  "fork-save-failed",
  "fork-save-conflict",
  "fork-response-invalid",
  "fork-operation-conflict",
  "publication-lineage-mismatch",
  "publication-rights-required",
  "publication-operation-conflict",
  "share-token-update-failed",
  "share-token-response-invalid",
  "media-limits-exceeded",
  "media-storage-unavailable",
  "media-not-uploaded",
  "media-integrity-failed",
  "media-too-large",
  "invalid-media-reference",
  "unsupported-media-type",
  "media-read-failed",
  "media-response-invalid",
  "published-media-not-found",
  "media-unavailable",
);
export const PublishingErrorResponseSchema = Schema.Struct({
  schemaVersion: PublishingSchemaVersion,
  error: PublishingErrorCodeSchema,
});
export type PublishingErrorCode = typeof PublishingErrorCodeSchema.Type;
export type PublishingErrorResponse = typeof PublishingErrorResponseSchema.Type;

const AttributionSchema = Schema.NullOr(Schema.String.pipe(Schema.maxLength(500)));
const LicenseSchema = Schema.NullOr(Schema.String.pipe(Schema.maxLength(120)));
const HashSchema = Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/i));
const TimestampSchema = Schema.String.pipe(
  Schema.maxLength(40),
  Schema.pattern(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/),
  Schema.filter((value) => normalizeReviewTimestamp(value) !== null),
);

/** Supabase row projections are partial, depending on the publication operation. */
export const PublishedKnowledgeAreaRowSchema = Schema.Struct({
  id: Schema.optional(PublicationVersionIdSchema),
  source_area_id: Schema.optional(Schema.NullOr(AreaIdSchema)),
  owner_id: Schema.optional(Schema.NullOr(Schema.String)),
  version: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  content: Schema.optional(Schema.Unknown),
  content_hash: Schema.optional(HashSchema),
  visibility: Schema.optional(PublicationVisibilitySchema),
  attribution: Schema.optional(AttributionSchema),
  license: Schema.optional(LicenseSchema),
  forked_from_version_id: Schema.optional(Schema.NullOr(PublicationVersionIdSchema)),
  created_at: Schema.optional(TimestampSchema),
});

export const PublishKnowledgeAreaRequestSchema = Schema.Struct({
  schemaVersion: PublishingSchemaVersion,
  operationId: PublicationForkOperationIdSchema,
  shareToken: Schema.optional(PublishedShareTokenSchema),
  sourceAreaId: AreaIdSchema,
  content: KnowledgeAreaSchema,
  visibility: PublicationVisibilitySchema,
  attribution: Schema.optional(AttributionSchema),
  license: Schema.optional(LicenseSchema),
  forkedFromVersionId: Schema.optional(Schema.NullOr(PublicationVersionIdSchema)),
  reuseConfirmed: Schema.optional(Schema.Boolean),
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
  schemaVersion: PublishingSchemaVersion,
  operationId: PublicationForkOperationIdSchema,
  version: PublishedKnowledgeAreaVersionSchema,
  shareToken: Schema.optional(PublishedShareTokenSchema),
});

export const ReadPublishedKnowledgeAreaRequestSchema = Schema.Struct({
  versionId: PublicationVersionIdSchema,
  shareToken: Schema.NullOr(PublishedShareTokenSchema),
});

export const ReadPublishedKnowledgeAreaResponseSchema = Schema.Struct({
  schemaVersion: PublishingSchemaVersion,
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

export const CheckPublicationUpdatesRequestSchema = Schema.Struct({
  versionId: PublicationVersionIdSchema,
  sourceAreaId: Schema.optional(CanonicalUuidSchema),
  shareToken: Schema.optional(PublishedShareTokenSchema),
});
const PublicationUpdateIdentitySchema = Schema.Struct({
  id: PublicationVersionIdSchema,
  version: Schema.Number.pipe(Schema.int(), Schema.positive()),
  sourceAreaId: CanonicalUuidSchema,
});
export const CheckPublicationUpdatesResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  knownVersion: PublicationUpdateIdentitySchema,
  latestPublicVersion: Schema.NullOr(
    Schema.Struct({
      ...PublicationUpdateIdentitySchema.fields,
      createdAt: TimestampSchema,
    }),
  ),
});
export type CheckPublicationUpdatesRequest = typeof CheckPublicationUpdatesRequestSchema.Type;
export type CheckPublicationUpdatesResponse = typeof CheckPublicationUpdatesResponseSchema.Type;

export const ForkPublishedKnowledgeAreaRequestSchema = Schema.Struct({
  schemaVersion: PublishingSchemaVersion,
  operationId: PublicationForkOperationIdSchema,
  shareToken: Schema.optional(PublishedShareTokenSchema),
});

export const ForkPublishedKnowledgeAreaResponseSchema = Schema.Struct({
  schemaVersion: PublishingSchemaVersion,
  operationId: PublicationForkOperationIdSchema,
  saved: Schema.Literal(true),
  areaId: AreaIdSchema,
  contentHash: HashSchema,
  document: KnowledgeAreaSchema,
  attribution: AttributionSchema,
  license: LicenseSchema,
  forkedFromVersionId: PublicationVersionIdSchema,
});

export const RotatePublishedShareTokenRequestSchema = Schema.Struct({
  schemaVersion: PublishingSchemaVersion,
  action: Schema.Union(Schema.Literal("rotate"), Schema.Literal("revoke")),
});

export const RotatePublishedShareTokenResponseSchema = Schema.Struct({
  schemaVersion: PublishingSchemaVersion,
  versionId: PublicationVersionIdSchema,
  token: Schema.NullOr(PublishedShareTokenSchema),
});

export type PublishKnowledgeAreaRequest = typeof PublishKnowledgeAreaRequestSchema.Type;
export type PublishedKnowledgeAreaRow = typeof PublishedKnowledgeAreaRowSchema.Type;
export type PublishKnowledgeAreaResponse = typeof PublishKnowledgeAreaResponseSchema.Type;
export type ReadPublishedKnowledgeAreaRequest = typeof ReadPublishedKnowledgeAreaRequestSchema.Type;
export type ReadPublishedKnowledgeAreaResponse =
  typeof ReadPublishedKnowledgeAreaResponseSchema.Type;
export type ForkPublishedKnowledgeAreaRequest = typeof ForkPublishedKnowledgeAreaRequestSchema.Type;
export type ForkPublishedKnowledgeAreaResponse =
  typeof ForkPublishedKnowledgeAreaResponseSchema.Type;
export type RotatePublishedShareTokenRequest = typeof RotatePublishedShareTokenRequestSchema.Type;
export type RotatePublishedShareTokenResponse = typeof RotatePublishedShareTokenResponseSchema.Type;
