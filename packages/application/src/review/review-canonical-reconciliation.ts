import { Effect, Schema } from "effect";
import { normalizeReviewTimestamp } from "@recall/contracts";
import { ReviewEventSchema, type ReviewEvent } from "@recall/domain";

export type ReviewCanonicalReconciliationFailure = {
  readonly _tag: "ReviewCanonicalReconciliationFailure";
};
const failure = (): ReviewCanonicalReconciliationFailure => ({
  _tag: "ReviewCanonicalReconciliationFailure",
});

function timestamp(value: string): number | null {
  const canonical = normalizeReviewTimestamp(value);
  return canonical === null ? null : Date.parse(canonical);
}

/** Server area is current placement and time is derived metadata; immutable evidence must match. */
export function reconcileCanonicalReview(
  localInput: unknown,
  serverInput: unknown,
  currentAreaId?: string,
): Effect.Effect<ReviewEvent, ReviewCanonicalReconciliationFailure> {
  return Effect.gen(function* () {
    const local = yield* Schema.decodeUnknown(ReviewEventSchema)(localInput).pipe(
      Effect.mapError(failure),
    );
    const server = yield* Schema.decodeUnknown(ReviewEventSchema)(serverInput).pipe(
      Effect.mapError(failure),
    );
    const rawLocal = local.reviewedAtDevice ?? local.ratedAt;
    const rawServer = server.reviewedAtDevice ?? server.ratedAt;
    const rawTime = timestamp(rawLocal);
    const ratedAt = timestamp(server.ratedAt);
    const effective = timestamp(server.effectiveReviewedAt ?? server.ratedAt);
    if (
      local.id !== server.id ||
      local.cardId !== server.cardId ||
      (server.areaId !== local.areaId && server.areaId !== currentAreaId) ||
      local.rating !== server.rating ||
      local.deviceId !== server.deviceId ||
      local.deviceSequence !== server.deviceSequence ||
      (local.baseReviewEventId ?? null) !== (server.baseReviewEventId ?? null) ||
      local.schedulerVersion !== server.schedulerVersion ||
      (local.schedulerParameterSetId ?? null) !== (server.schedulerParameterSetId ?? null) ||
      (local.previousStateHash ?? null) !== (server.previousStateHash ?? null) ||
      (local.elapsedMs ?? null) !== (server.elapsedMs ?? null) ||
      rawTime === null ||
      rawTime !== timestamp(rawServer) ||
      ratedAt === null ||
      ratedAt !== effective
    )
      return yield* Effect.fail(failure());
    const canonicalTime = new Date(ratedAt).toISOString();
    return {
      ...local,
      reviewedAtDevice: rawLocal,
      ratedAt: canonicalTime,
      effectiveReviewedAt: canonicalTime,
    };
  });
}
