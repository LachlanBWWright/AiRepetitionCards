import { Schema } from "effect";
import { AccountIdSchema } from "@recall/domain";

const AssessmentIdentitySchema = AccountIdSchema.pipe(Schema.brand("AssessmentId"));
const AreaIdentitySchema = AccountIdSchema.pipe(Schema.brand("AreaId"));

export const WorkspaceReviewIdentitiesRequestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  cardIds: Schema.Array(AssessmentIdentitySchema).pipe(
    Schema.minItems(1),
    Schema.maxItems(100),
    Schema.filter((ids) => new Set(ids).size === ids.length),
  ),
});

export const WorkspaceReviewIdentitiesResponseSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  ownerId: AccountIdSchema,
  reviewCards: Schema.Array(
    Schema.Struct({
      id: AssessmentIdentitySchema,
      areaId: AreaIdentitySchema,
      deleted: Schema.Boolean,
    }),
  ).pipe(
    Schema.maxItems(100),
    Schema.filter((cards) => new Set(cards.map((card) => card.id)).size === cards.length),
  ),
});

export type WorkspaceReviewIdentitiesRequest = typeof WorkspaceReviewIdentitiesRequestSchema.Type;
export type WorkspaceReviewIdentitiesResponse = typeof WorkspaceReviewIdentitiesResponseSchema.Type;
