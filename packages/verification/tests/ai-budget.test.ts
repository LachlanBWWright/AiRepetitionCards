import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { Effect, Either } from "effect";
import {
  reserveAiUsage,
  settleAiUsage,
  type AiUsageBudget,
  type AiUsageReservation,
  type AiUsageReservationRequest,
  type AiUsageSettlement,
} from "@recall/application";

const userId = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const request: AiUsageReservationRequest = {
  userId,
  operationId,
  day: "2026-10-03",
  operation: "question",
  model: "fixture-model",
  requestBytes: 1000,
  maxOutputTokens: 1200,
};
const reservation: AiUsageReservation = {
  userId,
  operationId,
  day: request.day,
  reservedUnits: 2200,
};
function fakeBudget(change: (value: AiUsageReservation) => AiUsageReservation = (value) => value) {
  const reserveCalls: AiUsageReservationRequest[] = [];
  const settleCalls: AiUsageSettlement[] = [];
  const holds = new Map<string, AiUsageReservation>();
  const charged = new Map<string, number>();
  const key = (value: AiUsageReservation) => `${value.userId}:${value.day}:${value.operationId}`;
  const budget: AiUsageBudget = {
    reserve: (value) =>
      Effect.sync(() => {
        reserveCalls.push(value);
        const created = change({
          userId: value.userId,
          day: value.day,
          operationId: value.operationId,
          reservedUnits: value.requestBytes + value.maxOutputTokens,
        });
        const identity = key(created);
        const existing = holds.get(identity);
        if (existing) return existing;
        holds.set(identity, created);
        return created;
      }),
    settle: (value) =>
      Effect.sync(() => {
        settleCalls.push(value);
        const identity = key(value.reservation);
        if (!charged.has(identity) && value.inputTokens !== null && value.outputTokens !== null) {
          charged.set(identity, value.inputTokens + value.outputTokens);
          holds.delete(identity);
        }
      }),
  };
  return { budget, reserveCalls, settleCalls, holds, charged };
}
async function unavailable<A>(effect: Effect.Effect<A, { readonly _tag: string }>) {
  const result = await Effect.runPromise(Effect.either(effect));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left._tag, "AiBudgetUnavailable");
}

void test("reservation uses exact request bytes plus configured output budget", async () => {
  const fake = fakeBudget();
  const result = await Effect.runPromise(Effect.either(reserveAiUsage(fake.budget, request)));
  assert.ok(Either.isRight(result));
  assert.deepEqual(result.right, reservation);
  assert.deepEqual(fake.reserveCalls, [request]);
  assert.equal(fake.holds.size, 1);
});

void test("invalid requests and unit overflow never reach the reservation port", async () => {
  for (const invalid of [
    null,
    {},
    { ...request, userId: "bad-id" },
    { ...request, operationId: "bad-id" },
    { ...request, day: "2026-02-30" },
    { ...request, day: "2026-2-03" },
    { ...request, operation: "arbitrary-operation" },
    { ...request, model: "" },
    { ...request, requestBytes: 0 },
    { ...request, requestBytes: -1 },
    { ...request, requestBytes: 1.5 },
    { ...request, maxOutputTokens: 0 },
    { ...request, requestBytes: Number.MAX_SAFE_INTEGER, maxOutputTokens: 1 },
  ]) {
    const fake = fakeBudget();
    await unavailable(reserveAiUsage(fake.budget, invalid));
    assert.deepEqual(fake.reserveCalls, []);
  }
});

void test("positive safe budgets preserve exact conservation across generated requests", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 1_000_000 }),
      fc.integer({ min: 1, max: 100_000 }),
      async (bytes, tokens) => {
        const fake = fakeBudget();
        const result = await Effect.runPromise(
          Effect.either(
            reserveAiUsage(fake.budget, {
              ...request,
              requestBytes: bytes,
              maxOutputTokens: tokens,
            }),
          ),
        );
        assert.ok(Either.isRight(result));
        assert.equal(result.right.reservedUnits, bytes + tokens);
      },
    ),
    { numRuns: 80, seed: 20261003 },
  );
});

void test("returned reservations must match owner, day, operation ID and hold exactly", async () => {
  for (const change of [
    (value: AiUsageReservation) => ({ ...value, userId: otherId }),
    (value: AiUsageReservation) => ({ ...value, day: "2026-10-04" }),
    (value: AiUsageReservation) => ({ ...value, operationId: otherId }),
    (value: AiUsageReservation) => ({ ...value, reservedUnits: value.reservedUnits + 1 }),
    (value: AiUsageReservation) => ({ ...value, reservedUnits: -1 }),
  ])
    await unavailable(reserveAiUsage(fakeBudget(change).budget, request));
});

void test("missing usage retains the hold and never calls settlement", async () => {
  for (const usage of [
    { inputTokens: null, outputTokens: null },
    { inputTokens: 10, outputTokens: null },
    { inputTokens: null, outputTokens: 10 },
  ]) {
    const fake = fakeBudget();
    const reserved = await Effect.runPromise(reserveAiUsage(fake.budget, request));
    const result = await Effect.runPromise(
      Effect.either(settleAiUsage(fake.budget, { reservation: reserved, ...usage })),
    );
    assert.ok(Either.isRight(result));
    assert.equal(fake.holds.size, 1);
    assert.deepEqual(fake.settleCalls, []);
  }
});

void test("invalid token counts and aggregate overflow never reach settlement", async () => {
  for (const usage of [
    { inputTokens: -1, outputTokens: 20 },
    { inputTokens: 1.5, outputTokens: 20 },
    { inputTokens: Number.NaN, outputTokens: 20 },
    { inputTokens: 20, outputTokens: Number.POSITIVE_INFINITY },
    { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 },
  ]) {
    const fake = fakeBudget();
    await unavailable(settleAiUsage(fake.budget, { reservation, ...usage }));
    assert.deepEqual(fake.settleCalls, []);
  }
});

void test("actual usage charges the idempotent port and releases the hold", async () => {
  const fake = fakeBudget();
  const first = await Effect.runPromise(reserveAiUsage(fake.budget, request));
  const retry = await Effect.runPromise(reserveAiUsage(fake.budget, request));
  assert.deepEqual(first, retry);
  assert.equal(fake.holds.size, 1);
  const settlement = { reservation: first, inputTokens: 600, outputTokens: 900 };
  await Effect.runPromise(settleAiUsage(fake.budget, settlement));
  await Effect.runPromise(settleAiUsage(fake.budget, settlement));
  assert.equal(fake.charged.size, 1);
  assert.deepEqual([...fake.charged.values()], [1500]);
  assert.equal(fake.holds.size, 0);
  assert.deepEqual(fake.settleCalls, [settlement, settlement]);
});

void test("proven overrun is charged before the caller receives failure", async () => {
  const fake = fakeBudget();
  const reserved = await Effect.runPromise(reserveAiUsage(fake.budget, request));
  await unavailable(
    settleAiUsage(fake.budget, { reservation: reserved, inputTokens: 1500, outputTokens: 1500 }),
  );
  assert.equal(fake.holds.size, 0);
  assert.deepEqual([...fake.charged.values()], [3000]);
  assert.equal(fake.settleCalls.length, 1);
});

void test("port errors retain their typed admission/settlement failures", async () => {
  const denied: AiUsageBudget = {
    reserve: () => Effect.fail({ _tag: "AiBudgetExceeded" } as const),
    settle: () => Effect.fail({ _tag: "AiBudgetUnavailable" } as const),
  };
  const reservationResult = await Effect.runPromise(Effect.either(reserveAiUsage(denied, request)));
  assert.ok(Either.isLeft(reservationResult));
  assert.equal(reservationResult.left._tag, "AiBudgetExceeded");
  await unavailable(settleAiUsage(denied, { reservation, inputTokens: 10, outputTokens: 20 }));
});

void test("settlement validates the reservation before missing-usage handling", async () => {
  const fake = fakeBudget();
  for (const invalid of [
    { ...reservation, userId: "bad-id" },
    { ...reservation, day: "2026-02-30" },
    { ...reservation, operationId: "bad-id" },
    { ...reservation, reservedUnits: 0 },
  ])
    await unavailable(
      settleAiUsage(fake.budget, { reservation: invalid, inputTokens: null, outputTokens: null }),
    );
  assert.deepEqual(fake.settleCalls, []);
});
