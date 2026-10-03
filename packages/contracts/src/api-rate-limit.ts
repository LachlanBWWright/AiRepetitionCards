import { Schema } from "effect";

export const ApiRateLimitErrorResponseSchema = Schema.Struct({
  error: Schema.Literal("rate-limited", "rate-limit-unavailable"),
  retryAfterSeconds: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 60))),
});
export type ApiRateLimitErrorResponse = typeof ApiRateLimitErrorResponseSchema.Type;
