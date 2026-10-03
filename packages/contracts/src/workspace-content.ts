import { Schema } from "effect";
import { AccountIdSchema, AreaIdSchema, CardIdSchema, KnowledgeAreaSchema } from "@recall/domain";

const ContentHashSchema = Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/i));

export const WorkspaceSnapshotSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  ownerId: AccountIdSchema,
  areas: Schema.Array(
    Schema.Struct({
      document: KnowledgeAreaSchema,
      color: Schema.String.pipe(Schema.pattern(/^#[0-9a-f]{6}$/i)),
      contentHash: ContentHashSchema,
    }),
  ),
  deletedAreaIds: Schema.Array(AreaIdSchema),
});

export const WorkspaceContentPushAreaSchema = Schema.Struct({
  document: KnowledgeAreaSchema,
  color: Schema.String.pipe(Schema.pattern(/^#[0-9a-f]{6}$/i)),
  baseContentHash: Schema.NullOr(ContentHashSchema),
});

export const WorkspaceCardTombstoneSchema = Schema.Struct({
  areaId: AreaIdSchema,
  cardId: CardIdSchema,
});

export const WorkspaceAreaTombstoneRequestSchema = Schema.Struct({
  areaTombstones: Schema.Array(
    Schema.Struct({
      areaId: AreaIdSchema,
      baseContentHash: ContentHashSchema,
    }),
  ).pipe(Schema.maxItems(100)),
});

export const WorkspaceContentPushRequestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  areas: Schema.Array(WorkspaceContentPushAreaSchema).pipe(Schema.maxItems(100)),
  tombstones: Schema.Array(WorkspaceCardTombstoneSchema).pipe(Schema.maxItems(2_000)),
});

export const WorkspaceContentPushResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  syncedAreas: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  syncedCards: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export type WorkspaceSnapshot = typeof WorkspaceSnapshotSchema.Type;
export type WorkspaceContentPushArea = typeof WorkspaceContentPushAreaSchema.Type;
export type WorkspaceCardTombstone = typeof WorkspaceCardTombstoneSchema.Type;
export type WorkspaceAreaTombstoneRequest = typeof WorkspaceAreaTombstoneRequestSchema.Type;
export type WorkspaceContentPushRequest = typeof WorkspaceContentPushRequestSchema.Type;
export type WorkspaceContentPushResponse = typeof WorkspaceContentPushResponseSchema.Type;
