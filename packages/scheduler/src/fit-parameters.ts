import { Effect } from "effect";
import { default_w } from "ts-fsrs";
import { evaluate } from "./fit-evaluation";
import type { ReviewEvent } from "@recall/domain";
import { orderReviewEvents } from "@recall/sync-core";
import { canonicalSchedulerWeights, validSchedulerWeights } from "./parameters";

export type ParameterFitFailure = {
  readonly _tag: "ParameterFitUnavailable";
  readonly reason: "insufficient-history" | "invalid-history" | "vendor-failure";
};
export type ParameterFitProposal = {
  readonly weights: readonly number[];
  readonly reviewsProcessed: number;
  readonly cardsProcessed: number;
  readonly reviewedAfter?: string;
  readonly observations: number;
  readonly validationObservations: number;
  readonly baselineLoss: number;
  readonly fittedLoss: number;
  readonly improved: boolean;
  readonly baselineRmse: number;
  readonly fittedRmse: number;
  readonly calibration: readonly {
    readonly predicted: number;
    readonly observed: number;
    readonly count: number;
  }[];
};
export type ParameterFitOptions = { readonly reviewedAfter?: string };

/** Deterministic, cooperative coordinate fitting over complete histories; never applies weights. */
export function fitSchedulerParameters(
  events: readonly ReviewEvent[],
  startingWeights?: readonly number[],
  options: ParameterFitOptions = {},
): Effect.Effect<ParameterFitProposal, ParameterFitFailure> {
  return Effect.gen(function* () {
    const failure = (reason: ParameterFitFailure["reason"]): ParameterFitFailure => ({
      _tag: "ParameterFitUnavailable",
      reason,
    });
    const byId = new Map<string, ReviewEvent>();
    for (const event of events) {
      const duplicate = byId.get(event.id);
      if (
        duplicate &&
        (duplicate.areaId !== event.areaId ||
          duplicate.cardId !== event.cardId ||
          duplicate.rating !== event.rating ||
          duplicate.ratedAt !== event.ratedAt ||
          duplicate.effectiveReviewedAt !== event.effectiveReviewedAt ||
          duplicate.baseReviewEventId !== event.baseReviewEventId)
      )
        return yield* Effect.fail(failure("invalid-history"));
      byId.set(event.id, event);
    }
    const unique = [...byId.values()];
    if (
      unique.some(
        (event) =>
          !Number.isFinite(Date.parse(event.ratedAt)) ||
          !Number.isFinite(Date.parse(event.effectiveReviewedAt ?? event.ratedAt)),
      )
    )
      return yield* Effect.fail(failure("invalid-history"));
    const reviewedAfter =
      options.reviewedAfter === undefined ? -Infinity : Date.parse(options.reviewedAfter);
    if (Number.isNaN(reviewedAfter)) return yield* Effect.fail(failure("invalid-history"));
    const ordered = orderReviewEvents(unique).events;
    const scoringTimes = ordered
      .map((event) => Date.parse(event.effectiveReviewedAt ?? event.ratedAt))
      .filter((at) => at >= reviewedAfter)
      .sort((a, b) => a - b);
    const cutoff = scoringTimes[Math.floor(scoringTimes.length * 0.8)] ?? Infinity;
    const score = (weights: readonly number[]) =>
      evaluate(ordered, weights, cutoff, reviewedAfter).pipe(
        Effect.catchAllDefect(() => Effect.fail(failure("vendor-failure"))),
      );
    const initial = canonicalSchedulerWeights(startingWeights ?? default_w);
    if (!validSchedulerWeights(initial)) return yield* Effect.fail(failure("vendor-failure"));
    const baseline = yield* score(initial);
    if (
      baseline.count < 100 ||
      baseline.validationCount < 20 ||
      baseline.count - baseline.validationCount < 60
    )
      return yield* Effect.fail(failure("insufficient-history"));
    let weights = initial;
    let best = baseline;
    for (const step of [0.25, 0.1, 0.025]) {
      for (let index = 0; index < weights.length; index += 1) {
        yield* Effect.sleep("1 millis");
        for (const direction of [-1, 1]) {
          const candidate = canonicalSchedulerWeights(
            weights.map((weight, position) =>
              position === index ? weight * (1 + step * direction) : weight,
            ),
          );
          if (!validSchedulerWeights(candidate)) continue;
          const result = yield* score(candidate);
          if (result.training < best.training) {
            weights = candidate;
            best = result;
          }
        }
      }
    }
    const improved = best.validation < baseline.validation - 0.0001 && best.rmse <= baseline.rmse;
    if (!improved) {
      weights = initial;
      best = baseline;
    }
    return {
      weights,
      reviewsProcessed: ordered.length,
      cardsProcessed: new Set(ordered.map((event) => `${event.areaId}:${event.cardId}`)).size,
      ...(options.reviewedAfter ? { reviewedAfter: options.reviewedAfter } : {}),
      observations: baseline.count,
      validationObservations: baseline.validationCount,
      baselineLoss: baseline.validation,
      fittedLoss: best.validation,
      baselineRmse: baseline.rmse,
      fittedRmse: best.rmse,
      calibration: best.calibration,
      improved,
    };
  });
}
