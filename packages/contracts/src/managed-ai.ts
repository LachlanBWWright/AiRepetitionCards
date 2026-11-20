import { Schema } from "effect";
const Nonnegative = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
  Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
export const ManagedAiStatusSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  accountId: Schema.UUID,
  available: Schema.Boolean,
  dailyLimitMicrousd: Nonnegative,
  usedMicrousd: Nonnegative,
  requestLimit: Nonnegative,
  requestsUsed: Nonnegative,
  expiresAt: Schema.NullOr(Schema.String),
});
export type ManagedAiStatus = typeof ManagedAiStatusSchema.Type;
