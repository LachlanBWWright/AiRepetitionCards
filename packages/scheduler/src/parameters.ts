import { checkParameters } from "ts-fsrs";
import { Effect, Either, Schema } from "effect";
import {
  AdvancedParameterSchema,
  validateSchedulingTimeZone,
  type AdvancedSchedulingParameters,
} from "./configuration/advanced-parameters";
export { validateSchedulingTimeZone } from "./configuration/advanced-parameters";

export type SchedulerParameters = AdvancedSchedulingParameters & {
  readonly requestRetention: number;
  readonly weights?: readonly number[] | undefined;
};
export const DEFAULT_SCHEDULER_PARAMETERS: SchedulerParameters = Object.freeze({
  requestRetention: 0.9,
});
export type UnknownSchedulerParameterSetError = {
  readonly _tag: "UnknownSchedulerParameterSetError";
  readonly parameterSetId: string;
};
const defaultPrefix = "ts-fsrs-5.4.2-default-r";
const fittedPrefix = "t542p1-";

/** Quantization makes fitted weights portable in the existing 80-character sync field. */
export function canonicalSchedulerWeights(weights: readonly number[]): readonly number[] {
  return weights.map((weight) => Math.round(weight * 1000) / 1000);
}

export function validateSchedulerWeights(
  input: readonly number[],
): Effect.Effect<readonly number[], { readonly _tag: "SchedulerWeightsInvalid" }> {
  const invalid = { _tag: "SchedulerWeightsInvalid" } as const;
  if (
    input.length !== 21 ||
    input.some((value) => !Number.isFinite(value) || value < 0 || value > 46.655)
  )
    return Effect.fail(invalid);
  return Effect.try({
    try: () => checkParameters(canonicalSchedulerWeights(input)),
    catch: () => invalid,
  });
}

export function schedulerParameterSetId(parameters: SchedulerParameters): string {
  const retention = Math.round(parameters.requestRetention * 10_000);
  if (
    [
      parameters.learningSteps,
      parameters.relearningSteps,
      parameters.maximumInterval,
      parameters.easyDays,
      parameters.timeZone,
      parameters.resetAt,
    ].some((value) => value !== undefined)
  ) {
    return `t542v2-${JSON.stringify({ r: retention / 10_000, ...(parameters.weights ? { w: canonicalSchedulerWeights(parameters.weights) } : {}), ...(parameters.learningSteps ? { l: parameters.learningSteps } : {}), ...(parameters.relearningSteps ? { a: parameters.relearningSteps } : {}), ...(parameters.maximumInterval !== undefined ? { m: parameters.maximumInterval } : {}), ...(parameters.easyDays ? { e: parameters.easyDays } : {}), ...(parameters.timeZone ? { z: parameters.timeZone } : {}), ...(parameters.resetAt ? { x: parameters.resetAt } : {}) })}`;
  }
  if (!parameters.weights) return `${defaultPrefix}${String(retention)}`;
  const encoded = canonicalSchedulerWeights(parameters.weights)
    .map((weight) =>
      Math.round(weight * 1000)
        .toString(36)
        .padStart(3, "0"),
    )
    .join("");
  return `${fittedPrefix}${retention.toString(36)}-${encoded}`;
}

export function schedulerParametersFromId(
  id: string | null | undefined,
): Effect.Effect<SchedulerParameters, UnknownSchedulerParameterSetError> {
  if (id == null) return Effect.succeed(DEFAULT_SCHEDULER_PARAMETERS);
  const invalid = { _tag: "UnknownSchedulerParameterSetError", parameterSetId: id } as const;
  if (id.startsWith("t542v2-") && id.length <= 2048)
    return Effect.gen(function* () {
      const raw = yield* Effect.try({
        try: () => JSON.parse(id.slice(7)) as unknown,
        catch: () => invalid,
      });
      const decoded = yield* Schema.decodeUnknown(AdvancedParameterSchema)(raw).pipe(
        Effect.mapError(() => invalid),
      );
      if (
        [decoded.l, decoded.a].some((steps) =>
          steps?.some((step, index) => index > 0 && step <= (steps[index - 1] ?? 0)),
        )
      )
        return yield* Effect.fail(invalid);
      if (decoded.w)
        yield* validateSchedulerWeights(decoded.w).pipe(Effect.mapError(() => invalid));
      if (decoded.z)
        yield* validateSchedulingTimeZone(decoded.z).pipe(Effect.mapError(() => invalid));
      return {
        requestRetention: decoded.r,
        weights: decoded.w,
        learningSteps: decoded.l,
        relearningSteps: decoded.a,
        maximumInterval: decoded.m,
        easyDays: decoded.e,
        timeZone: decoded.z,
        resetAt: decoded.x,
      };
    });
  const suffix = id.startsWith(defaultPrefix) ? id.slice(defaultPrefix.length) : "";
  const units = Number(suffix);
  if (/^\d{4}$/.test(suffix) && units >= 7000 && units <= 9700)
    return Effect.succeed({ requestRetention: units / 10_000 });
  const fitted = /^t542p1-([0-9a-z]{3})-([0-9a-z]{63})$/.exec(id);
  if (!fitted?.[1] || !fitted[2]) return Effect.fail(invalid);
  const retention = parseInt(fitted[1], 36);
  const encoded = fitted[2];
  const weights = Array.from(
    { length: 21 },
    (_, index) => parseInt(encoded.slice(index * 3, index * 3 + 3), 36) / 1000,
  );
  if (retention < 7000 || retention > 9700) return Effect.fail(invalid);
  return validateSchedulerWeights(weights).pipe(
    Effect.mapError(() => invalid),
    Effect.flatMap((validated) => {
      const parameters = { requestRetention: retention / 10_000, weights: validated };
      return schedulerParameterSetId(parameters) === id
        ? Effect.succeed(parameters)
        : Effect.fail(invalid);
    }),
  );
}

export function validSchedulerWeights(input: readonly number[]): boolean {
  return Either.isRight(Effect.runSync(Effect.either(validateSchedulerWeights(input))));
}
