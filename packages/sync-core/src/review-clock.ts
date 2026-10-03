import { normalizeReviewTimestamp } from "@recall/contracts";
import { Effect } from "effect";

export type ReviewClockFailure = {
  readonly _tag: "ReviewClockFailure";
  readonly reason: "invalid-device-time" | "invalid-reception-time";
};
export type EffectiveReviewTime = {
  readonly reviewedAtDevice: string;
  readonly effectiveReviewedAt: string;
  readonly futureClamped: boolean;
};
/** No offset is invented: old offline evidence stays old, future device clocks clamp to reception. */
export function deriveEffectiveReviewTime(
  reviewedAtDevice: unknown,
  serverReceivedAt: unknown,
): Effect.Effect<EffectiveReviewTime, ReviewClockFailure> {
  const device = normalizeReviewTimestamp(reviewedAtDevice);
  const reception = normalizeReviewTimestamp(serverReceivedAt);
  if (device === null || typeof reviewedAtDevice !== "string")
    return Effect.fail({ _tag: "ReviewClockFailure", reason: "invalid-device-time" });
  if (reception === null)
    return Effect.fail({ _tag: "ReviewClockFailure", reason: "invalid-reception-time" });
  const futureClamped = Date.parse(device) > Date.parse(reception);
  return Effect.succeed({
    reviewedAtDevice,
    effectiveReviewedAt: futureClamped ? reception : device,
    futureClamped,
  });
}
