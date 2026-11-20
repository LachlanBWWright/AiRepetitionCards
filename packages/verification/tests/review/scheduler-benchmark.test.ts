import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import {
  createAreaId,
  createAssessmentId,
  createReviewEventId,
  type ReviewEvent,
} from "@recall/domain";
import { benchmarkSchedulerFit, canonicalSchedulerWeights } from "@recall/scheduler";
import { evaluate } from "../../../scheduler/src/fit-evaluation";
const start = Date.parse("2026-01-01T12:00:00Z");
const history: readonly ReviewEvent[] = Array.from({ length: 125 }, (_, index) => ({
  id: createReviewEventId(`benchmark-${String(index)}`),
  areaId: createAreaId("benchmark-area"),
  cardId: createAssessmentId("benchmark-card"),
  ratedAt: new Date(start + index * 86_400_000).toISOString(),
  baseReviewEventId: index ? createReviewEventId(`benchmark-${String(index - 1)}`) : null,
  rating: index % 5 === 0 ? "again" : "good",
  schedulerFamily: "fsrs",
  schedulerVersion: "ts-fsrs@5.4.2",
}));
const weights = [
  0.3, 1.3, 2.3, 8.3, 6.4, 0.8, 3, 0.1, 1.2, 0.2, 0.8, 1.5, 0.1, 0.3, 1.5, 0.2, 2, 0.5, 0.1, 0.1,
  0.1542,
];
await test("optimizer comparison scores external weights on the identical held-out timestamps without changing history", async () => {
  const before = structuredClone(history);
  const ticks = [10, 25];
  let index = 0;
  const result = await Effect.runPromise(
    benchmarkSchedulerFit(
      {
        events: history,
        referenceName: "Synthetic reference control; not an Anki optimizer result",
        referenceWeights: weights,
      },
      () => ticks[index++] ?? NaN,
    ),
  );
  const expected = await Effect.runPromise(
    evaluate(history, canonicalSchedulerWeights(weights), start + 100 * 86_400_000, -Infinity),
  );
  assert.equal(result.referenceLogLoss, expected.validation);
  assert.equal(result.referenceRmse, expected.rmse);
  assert.equal(result.fitElapsedMs, 15);
  assert.equal(result.holdoutObservations, 25);
  assert.deepEqual(history, before);
});
await test("optimizer comparison rejects incompatible reference weights and missing history", async () => {
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(
        Effect.either(
          benchmarkSchedulerFit(
            { events: history, referenceName: "Invalid", referenceWeights: [] },
            () => 0,
          ),
        ),
      ),
    ),
  );
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(
        Effect.either(
          benchmarkSchedulerFit(
            { events: [], referenceName: "Empty", referenceWeights: weights },
            () => 0,
          ),
        ),
      ),
    ),
  );
});
