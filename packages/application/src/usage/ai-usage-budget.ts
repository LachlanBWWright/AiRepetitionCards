import { AccountIdSchema } from "@recall/domain";
import { AiOperationSchema } from "@recall/ai-core";
import { Effect, Schema } from "effect";

export type AiUsageBudgetFailure =
  { readonly _tag: "AiBudgetExceeded" } | { readonly _tag: "AiBudgetUnavailable" };
const UnitsSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
  Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
const DaySchema = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.filter((day) => {
    const time = new Date(`${day}T00:00:00.000Z`);
    return Number.isFinite(time.getTime()) && time.toISOString().slice(0, 10) === day;
  }),
);
export const AiUsageReservationRequestSchema = Schema.Struct({
  userId: AccountIdSchema,
  day: DaySchema,
  operationId: AccountIdSchema,
  operation: AiOperationSchema,
  model: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120)),
  requestBytes: UnitsSchema.pipe(Schema.positive()),
  maxOutputTokens: UnitsSchema.pipe(Schema.positive()),
});
export const AiUsageReservationSchema = Schema.Struct({
  userId: AccountIdSchema,
  day: DaySchema,
  operationId: AccountIdSchema,
  reservedUnits: UnitsSchema.pipe(Schema.positive()),
});
export type AiUsageReservationRequest = typeof AiUsageReservationRequestSchema.Type;
export type AiUsageReservation = typeof AiUsageReservationSchema.Type;
export type AiUsageSettlement = {
  readonly reservation: AiUsageReservation;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
};
/** Implementations reserve atomically and settle idempotently across server processes. */
export interface AiUsageBudget {
  readonly reserve: (
    request: AiUsageReservationRequest,
  ) => Effect.Effect<AiUsageReservation, AiUsageBudgetFailure>;
  readonly settle: (settlement: AiUsageSettlement) => Effect.Effect<void, AiUsageBudgetFailure>;
}
const unavailable = (): AiUsageBudgetFailure => ({ _tag: "AiBudgetUnavailable" });

/** Exact request bytes plus enforced output tokens are conservative admission units, not a billing guarantee. */
export function reserveAiUsage(
  budget: AiUsageBudget,
  input: unknown,
): Effect.Effect<AiUsageReservation, AiUsageBudgetFailure> {
  return Effect.gen(function* () {
    const request = yield* Schema.decodeUnknown(AiUsageReservationRequestSchema)(input).pipe(
      Effect.mapError(unavailable),
    );
    const reservedUnits = request.requestBytes + request.maxOutputTokens;
    if (!Number.isSafeInteger(reservedUnits)) return yield* Effect.fail(unavailable());
    const rawReservation = yield* budget.reserve(request);
    const reservation = yield* Schema.decodeUnknown(AiUsageReservationSchema)(rawReservation).pipe(
      Effect.mapError(unavailable),
    );
    if (
      reservation.userId !== request.userId ||
      reservation.day !== request.day ||
      reservation.operationId !== request.operationId ||
      reservation.reservedUnits !== reservedUnits
    )
      return yield* Effect.fail(unavailable());
    return reservation;
  });
}

/** Missing usage keeps the hold. Proven usage, including an overrun, is charged before returning a failure. */
export function settleAiUsage(
  budget: AiUsageBudget,
  input: AiUsageSettlement,
): Effect.Effect<void, AiUsageBudgetFailure> {
  return Effect.gen(function* () {
    const reservation = yield* Schema.decodeUnknown(AiUsageReservationSchema)(
      input.reservation,
    ).pipe(Effect.mapError(unavailable));
    if (input.inputTokens === null || input.outputTokens === null) return;
    const inputTokens = yield* Schema.decodeUnknown(UnitsSchema)(input.inputTokens).pipe(
      Effect.mapError(unavailable),
    );
    const outputTokens = yield* Schema.decodeUnknown(UnitsSchema)(input.outputTokens).pipe(
      Effect.mapError(unavailable),
    );
    const actual = inputTokens + outputTokens;
    if (!Number.isSafeInteger(actual)) return yield* Effect.fail(unavailable());
    yield* budget.settle({ reservation, inputTokens, outputTokens });
    if (actual > reservation.reservedUnits) return yield* Effect.fail(unavailable());
  });
}
