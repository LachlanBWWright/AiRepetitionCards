import { Schema } from "effect";
import { AccountIdSchema } from "@recall/domain";

const CardIdentitySchema = AccountIdSchema.pipe(Schema.brand("CardId"));
const AreaIdentitySchema = AccountIdSchema.pipe(Schema.brand("AreaId"));

export const WorkspaceReviewIdentitiesRequestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  cardIds: Schema.Array(CardIdentitySchema).pipe(
    Schema.minItems(1),
    Schema.maxItems(100),
    Schema.filter((ids) => new Set(ids).size === ids.length),
  ),
});

export const WorkspaceReviewIdentitiesResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  ownerId: AccountIdSchema,
  reviewCards: Schema.Array(
    Schema.Struct({ id: CardIdentitySchema, areaId: AreaIdentitySchema, deleted: Schema.Boolean }),
  ).pipe(
    Schema.maxItems(100),
    Schema.filter((cards) => new Set(cards.map((card) => card.id)).size === cards.length),
  ),
});

export type WorkspaceReviewIdentitiesRequest = typeof WorkspaceReviewIdentitiesRequestSchema.Type;
export type WorkspaceReviewIdentitiesResponse = typeof WorkspaceReviewIdentitiesResponseSchema.Type;
