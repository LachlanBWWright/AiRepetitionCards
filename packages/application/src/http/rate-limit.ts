import { Effect, Schema } from "effect";

export const ApiRateLimitScopeSchema = Schema.Literal(
  "review-sync",
  "workspace-sync",
  "tutor-read",
  "tutor-write",
);
export type ApiRateLimitScope = typeof ApiRateLimitScopeSchema.Type;

const RequestSchema = Schema.Struct({
  subject: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  scope: ApiRateLimitScopeSchema,
  now: Schema.Number.pipe(
    Schema.int(),
    Schema.nonNegative(),
    Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER - 60_000),
  ),
});
const DecisionSchema = Schema.Struct({
  allowed: Schema.Boolean,
  remaining: Schema.Number.pipe(Schema.int(), Schema.between(0, 120)),
  retryAfterSeconds: Schema.Number.pipe(Schema.int(), Schema.between(1, 60)),
});
export type ApiRateLimitDecision = typeof DecisionSchema.Type;
export type ApiRateLimitFailure = {
  readonly _tag: "ApiRateLimitUnavailable";
  readonly reason: "invalid-request" | "store-unavailable" | "capacity" | "invalid-decision";
};
export interface ApiRateLimitPolicy {
  readonly requests: number;
  readonly windowMilliseconds: number;
}
/** consume must atomically check and increment one authenticated subject/scope bucket. */
export interface ApiRateLimitStore {
  readonly consume: (input: {
    readonly subject: string;
    readonly scope: ApiRateLimitScope;
    readonly now: number;
    readonly policy: ApiRateLimitPolicy;
  }) => Effect.Effect<unknown, ApiRateLimitFailure>;
}
const policies: Readonly<Record<ApiRateLimitScope, ApiRateLimitPolicy>> = {
  "review-sync": { requests: 120, windowMilliseconds: 60_000 },
  "workspace-sync": { requests: 30, windowMilliseconds: 60_000 },
  "tutor-read": { requests: 60, windowMilliseconds: 60_000 },
  "tutor-write": { requests: 20, windowMilliseconds: 60_000 },
};

/** Time is explicit; infrastructure owns storage, atomicity and deployment scope. */
export function checkApiRateLimit(
  input: unknown,
  store: ApiRateLimitStore,
): Effect.Effect<ApiRateLimitDecision, ApiRateLimitFailure> {
  return Effect.gen(function* () {
    const request = yield* Schema.decodeUnknown(RequestSchema)(input).pipe(
      Effect.mapError((): ApiRateLimitFailure => ({
        _tag: "ApiRateLimitUnavailable",
        reason: "invalid-request",
      })),
    );
    const policy = policies[request.scope];
    const raw = yield* store.consume({ ...request, policy });
    const decision = yield* Schema.decodeUnknown(DecisionSchema)(raw).pipe(
      Effect.mapError((): ApiRateLimitFailure => ({
        _tag: "ApiRateLimitUnavailable",
        reason: "invalid-decision",
      })),
    );
    if (decision.remaining > policy.requests || (!decision.allowed && decision.remaining !== 0)) {
      return yield* Effect.fail<ApiRateLimitFailure>({
        _tag: "ApiRateLimitUnavailable",
        reason: "invalid-decision",
      });
    }
    return decision;
  });
}
