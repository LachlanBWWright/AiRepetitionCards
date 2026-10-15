import { Schema } from "effect";

const Uuid = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);
const PositiveInt = Schema.Number.pipe(Schema.int(), Schema.positive());
const NonNegativeInt = Schema.Number.pipe(Schema.int(), Schema.nonNegative());
const IsoDate = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/),
);

export const DeckIdSchema = Uuid;
export const DeckSummarySchema = Schema.Struct({
  id: Uuid,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(300)),
  description: Schema.String.pipe(Schema.maxLength(4000)),
  language: Schema.String.pipe(Schema.maxLength(40)),
  tags: Schema.Array(Schema.String.pipe(Schema.maxLength(80))).pipe(Schema.maxItems(30)),
  authorName: Schema.String.pipe(Schema.maxLength(120)),
  visibility: Schema.Union(
    Schema.Literal("private"),
    Schema.Literal("unlisted"),
    Schema.Literal("public"),
  ),
  status: Schema.Union(Schema.Literal("active"), Schema.Literal("withdrawn")),
  latestVersionId: Uuid,
  version: PositiveInt,
  cardCount: NonNegativeInt,
  updatedAt: IsoDate,
  license: Schema.NullOr(Schema.String),
  attribution: Schema.NullOr(Schema.String),
});
export const DeckVersionSummarySchema = Schema.Struct({
  id: Uuid,
  version: PositiveInt,
  createdAt: IsoDate,
});
export const DeckListResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  decks: Schema.Array(DeckSummarySchema),
  nextCursor: Schema.NullOr(Uuid),
});
export const DeckDetailResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  deck: DeckSummarySchema,
  versions: Schema.Array(DeckVersionSummarySchema),
  canManage: Schema.Boolean,
});
export const DeckSubscriptionSchema = Schema.Struct({
  deckId: Uuid,
  areaId: Uuid,
  versionId: Uuid,
  following: Schema.Boolean,
});
export const DeckSubscriptionsResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  subscriptions: Schema.Array(DeckSubscriptionSchema),
});
export const DeckFeedbackSchema = Schema.Struct({
  id: Uuid,
  versionId: Uuid,
  cardId: Schema.NullOr(Schema.String),
  message: Schema.String,
  kind: Schema.Union(Schema.Literal("issue"), Schema.Literal("suggestion")),
  status: Schema.Union(Schema.Literal("open"), Schema.Literal("resolved")),
  createdAt: IsoDate,
});
export const DeckFeedbackResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  feedback: Schema.Array(DeckFeedbackSchema),
});
export const DeckMetadataPatchSchema = Schema.Struct({
  title: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(300))),
  description: Schema.optional(Schema.String.pipe(Schema.maxLength(4000))),
  language: Schema.optional(Schema.String.pipe(Schema.maxLength(40))),
  tags: Schema.optional(
    Schema.Array(Schema.String.pipe(Schema.maxLength(80))).pipe(Schema.maxItems(30)),
  ),
  authorName: Schema.optional(Schema.String.pipe(Schema.maxLength(120))),
  status: Schema.optional(Schema.Union(Schema.Literal("active"), Schema.Literal("withdrawn"))),
});
export const DeckMetadataResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  deck: DeckSummarySchema,
});
export const DeckSubscriptionRequestSchema = DeckSubscriptionSchema;
export const DeckFeedbackRequestSchema = Schema.Struct({
  id: Uuid,
  versionId: Uuid,
  cardId: Schema.NullOr(Schema.String),
  message: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(4000)),
  kind: Schema.Union(Schema.Literal("issue"), Schema.Literal("suggestion")),
});
export const DeckFeedbackStatusRequestSchema = Schema.Struct({
  status: Schema.Union(Schema.Literal("open"), Schema.Literal("resolved")),
});

export const DeckSubscriptionUpdateSchema = Schema.Struct({
  deckId: Uuid,
  areaId: Uuid,
  knownVersionId: Uuid,
  latestVersionId: Uuid,
  latestVersion: PositiveInt,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(300)),
  releaseNotes: Schema.String.pipe(Schema.maxLength(4000)),
  createdAt: IsoDate,
  seen: Schema.Boolean,
});
export const DeckSubscriptionUpdatesResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  updates: Schema.Array(DeckSubscriptionUpdateSchema).pipe(Schema.maxItems(500)),
});
export const DeckSubscriptionUpdateReadRequestSchema = Schema.Struct({ versionId: Uuid });
export const DeckReportRequestSchema = Schema.Struct({
  id: Uuid,
  versionId: Uuid,
  reason: Schema.Union(
    Schema.Literal("spam"),
    Schema.Literal("harmful"),
    Schema.Literal("copyright"),
    Schema.Literal("broken"),
  ),
  message: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  token: Schema.optional(Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{43}$/))),
});
export const DeckReportResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  reportId: Uuid,
  status: Schema.Union(Schema.Literal("open"), Schema.Literal("resolved")),
});
export const DeckBlockResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  blocked: Schema.Boolean,
});
export const ModerationReportSchema = Schema.Struct({
  id: Uuid,
  deckId: Uuid,
  versionId: Uuid,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(300)),
  reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(32)),
  message: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
  status: Schema.Union(Schema.Literal("open"), Schema.Literal("resolved")),
  createdAt: IsoDate,
});
export const ModerationReportsResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  reports: Schema.Array(ModerationReportSchema).pipe(Schema.maxItems(1000)),
});
export const ModerationDeckRequestSchema = Schema.Struct({
  status: Schema.Union(Schema.Literal("visible"), Schema.Literal("hidden")),
  reason: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000)),
});
export const ModerationReportRequestSchema = Schema.Struct({
  status: Schema.Union(Schema.Literal("open"), Schema.Literal("resolved")),
});
export const ModerationMutationResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  ok: Schema.Literal(true),
});

export type DeckSummary = typeof DeckSummarySchema.Type;
export type DeckVersionSummary = typeof DeckVersionSummarySchema.Type;
export type DeckSubscription = typeof DeckSubscriptionSchema.Type;
export type DeckFeedback = typeof DeckFeedbackSchema.Type;
export type DeckSubscriptionUpdate = typeof DeckSubscriptionUpdateSchema.Type;
export type ModerationReport = typeof ModerationReportSchema.Type;
