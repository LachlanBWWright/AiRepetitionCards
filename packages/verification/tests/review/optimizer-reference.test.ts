import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import {
  createAreaId,
  createAssessmentId,
  createReviewEventId,
  type ReviewEvent,
} from "@recall/domain";
import { benchmarkSchedulerFit } from "@recall/scheduler";
import { optimizerReference } from "./optimizer-reference-fixture";

const initial = Date.parse("2026-01-01T12:00:00Z");
const history: readonly ReviewEvent[] = Array.from({ length: 24 }, (_, card) => {
  const profile = card % 3;
  const failure = [8, 4, 1][profile] ?? 0;
  return Array.from({ length: 40 }, (_, index): ReviewEvent => {
    const choice = (card * 17 + index * 11) % 20;
    const id = `${String(card)}-${String(index)}`;
    return {
      id: createReviewEventId(id),
      areaId: createAreaId("optimizer-reference"),
      cardId: createAssessmentId(String(card)),
      ratedAt: new Date(initial + index * (profile + 1) * 86400000 + card * 60000).toISOString(),
      baseReviewEventId: index ? createReviewEventId(`${String(card)}-${String(index - 1)}`) : null,
      rating: choice < failure ? "again" : choice === 9 ? "hard" : choice === 19 ? "easy" : "good",
      schedulerFamily: "fsrs",
      schedulerVersion: "ts-fsrs@5.4.2",
    };
  });
}).flat();

await test("locally fitted and independently optimized synthetic weights use the identical unseen holdout", async () => {
  const before = structuredClone(history);
  const result = await Effect.runPromise(
    benchmarkSchedulerFit(
      {
        events: history,
        referenceName: optimizerReference.referenceName,
        referenceWeights: optimizerReference.referenceWeights,
      },
      () => 0,
    ),
  );
  assert.equal(result.reviewsProcessed, optimizerReference.reviews);
  assert.equal(result.cardsProcessed, optimizerReference.cards);
  assert.equal(result.holdoutObservations, optimizerReference.holdoutObservations);
  assert.ok(Math.abs(result.referenceLogLoss - optimizerReference.holdoutLogLoss) < 0.000001);
  assert.ok(Math.abs(result.referenceRmse - optimizerReference.holdoutRmse) < 0.000001);
  assert.ok(Number.isFinite(result.logLossGapToReference));
  assert.ok(result.fittedLogLoss <= result.baselineLogLoss);
  assert.deepEqual(history, before);
  // A reproducible benchmark, not an assertion that the local optimizer matches the reference.
  console.info(JSON.stringify({ ...result, corpus: "synthetic mixed profiles" }));
});
