import { Schema } from "effect";

export const AreaIdSchema = Schema.String.pipe(Schema.minLength(1), Schema.brand("AreaId"));
export const ObjectiveIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand("ObjectiveId"),
);
export const CardIdSchema = Schema.String.pipe(Schema.minLength(1), Schema.brand("CardId"));
export const ReviewEventIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand("ReviewEventId"),
);
export const DeviceIdSchema = Schema.String.pipe(Schema.minLength(1), Schema.brand("DeviceId"));
export const TutorSessionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand("TutorSessionId"),
);
export const ProposalIdSchema = Schema.String.pipe(Schema.minLength(1), Schema.brand("ProposalId"));
export const ContentRevisionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand("ContentRevisionId"),
);
export const MediaIdSchema = Schema.String.pipe(
  Schema.pattern(/^[a-f0-9]{64}$/),
  Schema.brand("MediaId"),
);

export type AreaId = typeof AreaIdSchema.Type;
export type ObjectiveId = typeof ObjectiveIdSchema.Type;
export type CardId = typeof CardIdSchema.Type;
export type ReviewEventId = typeof ReviewEventIdSchema.Type;
export type DeviceId = typeof DeviceIdSchema.Type;
export type TutorSessionId = typeof TutorSessionIdSchema.Type;
export type ProposalId = typeof ProposalIdSchema.Type;
export type ContentRevisionId = typeof ContentRevisionIdSchema.Type;
export type MediaId = typeof MediaIdSchema.Type;
