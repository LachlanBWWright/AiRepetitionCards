import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either, Schema } from "effect";
import { SyncReviewOperationSchema } from "@recall/contracts";
import {
  createAreaId,
  createAssessmentId,
  createReviewEventId,
  type ReviewEvent,
} from "@recall/domain";
import {
  canonicalSchedulerWeights,
  fitSchedulerParameters,
  newSchedule,
  rebuildScheduleEffect,
  scheduleReview,
  schedulerParameterSetId,
  schedulerParametersFromId,
  validateSchedulerWeights,
} from "@recall/scheduler";

import { pythonFsrsReference } from "./fsrs-reference-fixture";

const initial = new Date("2026-01-01T12:00:00.000Z");
const weights = [
  0.3, 1.3, 2.3, 8.3, 6.4, 0.8, 3, 0.1, 1.2, 0.2, 0.8, 1.5, 0.1, 0.3, 1.5, 0.2, 2, 0.5, 0.1, 0.1,
  0.1542,
];
const areaId = createAreaId("fit-area");
const cardId = createAssessmentId("fit-card");
function review(index: number): ReviewEvent {
  return {
    id: createReviewEventId(`fit-${String(index)}`),
    areaId,
    cardId,
    ratedAt: new Date(initial.getTime() + index * 86_400_000).toISOString(),
    baseReviewEventId: index > 0 ? createReviewEventId(`fit-${String(index - 1)}`) : null,
    rating: index % 5 === 0 ? "again" : "good",
    schedulerFamily: "fsrs",
    schedulerVersion: "ts-fsrs@5.4.2",
  };
}

await test("fitted parameter IDs fit existing sync limits and replay quantized weights exactly", () => {
  const parameters = { requestRetention: 0.92345, weights };
  const id = schedulerParameterSetId(parameters);
  assert.ok(id.length <= 80);
  assert.ok(
    Either.isRight(
      Schema.decodeUnknownEither(SyncReviewOperationSchema)({
        id: "00000000-0000-4000-8000-000000000001",
        cardId: "00000000-0000-4000-8000-000000000002",
        deviceSequence: 1,
        baseReviewEventId: null,
        reviewedAtDevice: initial.toISOString(),
        effectiveReviewedAt: initial.toISOString(),
        rating: "good",
        elapsedMs: null,
        schedulerFamily: "fsrs",
        schedulerVersion: "ts-fsrs@5.4.2",
        schedulerParameterSetId: id,
        previousStateHash: null,
      }),
    ),
  );
  const decoded = Effect.runSync(schedulerParametersFromId(id));
  assert.deepEqual(decoded, {
    requestRetention: 0.9235,
    weights: canonicalSchedulerWeights(weights),
  });
  const original = newSchedule(initial);
  assert.deepEqual(
    scheduleReview(original, "easy", initial, parameters),
    scheduleReview(original, "easy", initial, decoded),
  );
  assert.notDeepEqual(
    scheduleReview(original, "easy", initial, parameters),
    scheduleReview(original, "easy", initial),
  );
});

await test("mixed personalized and default historical parameters replay without the current preference", () => {
  const first = {
    ...review(0),
    schedulerParameterSetId: schedulerParameterSetId({ requestRetention: 0.9, weights }),
  };
  const second = {
    ...review(1),
    schedulerParameterSetId: schedulerParameterSetId({ requestRetention: 0.8 }),
  };
  const before = structuredClone([first, second]);
  const expected = scheduleReview(
    scheduleReview(newSchedule(initial), first.rating, initial, { requestRetention: 0.9, weights }),
    second.rating,
    new Date(second.ratedAt),
    { requestRetention: 0.8 },
  );
  assert.deepEqual(Effect.runSync(rebuildScheduleEffect([second, first])), expected);
  assert.deepEqual([first, second], before);
});

await test("invalid fitted weights and malformed or unsupported IDs return typed failures", () => {
  for (const invalid of [
    [],
    [...weights, 1],
    weights.map(() => NaN),
    weights.map(() => -1),
    weights.map(() => 100),
  ])
    assert.ok(Either.isLeft(Effect.runSync(Effect.either(validateSchedulerWeights(invalid)))));
  const id = schedulerParameterSetId({ requestRetention: 0.9, weights });
  for (const invalid of [
    id.slice(0, -1),
    id.replace("t542p1", "t999p1"),
    `${id}!`,
    id.replace("6y0", "000"),
  ]) {
    if (invalid !== id)
      assert.ok(Either.isLeft(Effect.runSync(Effect.either(schedulerParametersFromId(invalid)))));
  }
});

await test("fitting fails explicitly with too little or malformed history", async () => {
  const small = await Effect.runPromise(
    Effect.either(fitSchedulerParameters([review(0), review(1)])),
  );
  assert.ok(Either.isLeft(small));
  assert.equal(small.left.reason, "insufficient-history");
  const invalid = await Effect.runPromise(
    Effect.either(fitSchedulerParameters([{ ...review(0), ratedAt: "invalid" }])),
  );
  assert.ok(Either.isLeft(invalid));
  assert.equal(invalid.left.reason, "invalid-history");
});

await test("local fitting proposes valid deterministic parameters without mutating history or worsening validation loss", async () => {
  const history = Array.from({ length: 125 }, (_, index) => review(index));
  const original = structuredClone(history);
  const proposal = await Effect.runPromise(fitSchedulerParameters(history));
  assert.ok(
    Math.abs(proposal.baselineLoss - pythonFsrsReference.holdoutLoss) < 0.000001,
    JSON.stringify({ proposal, reference: pythonFsrsReference }),
  );
  assert.ok(Math.abs(proposal.baselineRmse - pythonFsrsReference.holdoutRmse) < 0.000001);
  const replayed = Effect.runSync(rebuildScheduleEffect(history));
  assert.ok(Math.abs(replayed.stability - pythonFsrsReference.finalStability) < 0.000001);
  assert.ok(Math.abs(replayed.difficulty - pythonFsrsReference.finalDifficulty) < 0.000001);
  assert.equal(proposal.observations, 124);
  assert.equal(proposal.validationObservations, 25);
  assert.ok(Number.isFinite(proposal.fittedRmse));
  assert.equal(
    proposal.calibration.reduce((sum, bucket) => sum + bucket.count, 0),
    25,
  );
  assert.ok(Number.isFinite(proposal.baselineLoss));
  assert.ok(proposal.fittedLoss <= proposal.baselineLoss);
  assert.equal(proposal.weights.length, 21);
  assert.ok(
    schedulerParameterSetId({ requestRetention: 0.9, weights: proposal.weights }).length <= 80,
  );
  assert.deepEqual(
    await Effect.runPromise(fitSchedulerParameters([...history].reverse())),
    proposal,
  );
  assert.deepEqual(history, original);
});

await test("fitting includes more than 200 cards and 5000 events and excludes only pre-cutoff scores", async () => {
  const history = Array.from({ length: 601 }, (_, cardIndex) =>
    Array.from({ length: 9 }, (_, index) => ({
      ...review(index),
      cardId: createAssessmentId(`scale-${String(cardIndex)}`),
      id: createReviewEventId(`scale-${String(cardIndex)}-${String(index)}`),
      baseReviewEventId: index
        ? createReviewEventId(`scale-${String(cardIndex)}-${String(index - 1)}`)
        : null,
    })),
  ).flat();
  const proposal = await Effect.runPromise(fitSchedulerParameters(history));
  assert.equal(proposal.cardsProcessed, 601);
  assert.equal(proposal.reviewsProcessed, 5409);
  assert.equal(proposal.observations, 4808);
  const cutoff = review(20).ratedAt;
  const after = await Effect.runPromise(
    fitSchedulerParameters(
      Array.from({ length: 125 }, (_, index) => review(index)),
      undefined,
      { reviewedAfter: cutoff },
    ),
  );
  assert.equal(after.reviewsProcessed, 125);
  assert.equal(after.observations, 105);
  assert.equal(after.reviewedAfter, cutoff);
  const invalid = await Effect.runPromise(
    Effect.either(fitSchedulerParameters(history, undefined, { reviewedAfter: "invalid" })),
  );
  assert.ok(Either.isLeft(invalid));
  assert.equal(invalid.left.reason, "invalid-history");
});
