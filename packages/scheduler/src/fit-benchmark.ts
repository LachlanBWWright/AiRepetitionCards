import { Effect, Schema } from "effect";
import { ReviewEventSchema } from "@recall/domain";
import { orderReviewEvents } from "@recall/sync-core";
import { fitSchedulerParameters } from "./fit-parameters";
import { evaluate } from "./fit-evaluation";
import { canonicalSchedulerWeights, validSchedulerWeights } from "./parameters";

/** Compare independently obtained reference weights on exactly the same temporal holdout. */
export function benchmarkSchedulerFit(input: unknown, clock: () => number) {
  return Effect.gen(function* () {
    const failure = {
      _tag: "ParameterFitBenchmarkUnavailable",
      message:
        "Provide valid review history, independently fitted reference weights and a reference name.",
    } as const;
    const value = yield* Schema.decodeUnknown(
      Schema.Struct({
        events: Schema.Array(ReviewEventSchema),
        referenceName: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
        referenceWeights: Schema.Array(Schema.Number),
        reviewedAfter: Schema.optional(Schema.String),
      }),
    )(input).pipe(Effect.mapError(() => failure));
    const referenceWeights = canonicalSchedulerWeights(value.referenceWeights);
    if (!validSchedulerWeights(referenceWeights)) return yield* Effect.fail(failure);
    const started = yield* Effect.try({ try: clock, catch: () => failure });
    const proposal = yield* fitSchedulerParameters(
      value.events,
      undefined,
      value.reviewedAfter ? { reviewedAfter: value.reviewedAfter } : {},
    );
    const finished = yield* Effect.try({ try: clock, catch: () => failure });
    const events = orderReviewEvents([
      ...new Map(value.events.map((event) => [event.id, event])).values(),
    ]).events;
    const after = value.reviewedAfter ? Date.parse(value.reviewedAfter) : -Infinity;
    const times = events
      .map((event) => Date.parse(event.effectiveReviewedAt ?? event.ratedAt))
      .filter((at) => at >= after)
      .sort((a, b) => a - b);
    const cutoff = times[Math.floor(times.length * 0.8)] ?? Infinity;
    const reference = yield* evaluate(events, referenceWeights, cutoff, after).pipe(
      Effect.catchAllDefect(() => Effect.fail(failure)),
    );
    if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started)
      return yield* Effect.fail(failure);
    return {
      referenceName: value.referenceName,
      cardsProcessed: proposal.cardsProcessed,
      reviewsProcessed: proposal.reviewsProcessed,
      holdoutObservations: proposal.validationObservations,
      fitElapsedMs: finished - started,
      baselineLogLoss: proposal.baselineLoss,
      fittedLogLoss: proposal.fittedLoss,
      referenceLogLoss: reference.validation,
      fittedRmse: proposal.fittedRmse,
      referenceRmse: reference.rmse,
      logLossGapToReference: proposal.fittedLoss - reference.validation,
      improved: proposal.improved,
    };
  });
}
