import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { Effect, Either } from "effect";
import {
  emptyLocalAiUsageState,
  defaultLocalAiUsagePolicy,
  updateLocalAiUsagePolicy,
  reserveLocalAiUsage,
  settleLocalAiUsage,
  summarizeLocalAiUsage,
  createLocalBudgetService,
  decodeLocalBudgetRecord,
  parseLocalBudgetLimit,
  type LocalBudgetTransaction,
  type LocalAiUsageState,
} from "@recall/application";

const at = Date.parse("2026-10-04T23:59:59.999Z"); // Sunday, immediately before Monday.
const request = {
  requestId: "first",
  accountId: "local-account",
  model: "model",
  task: "tutor" as const,
  startedAt: at,
};
function success<A, E>(operation: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isRight(result));
  return result.right;
}
const limited = (
  daily: number | null,
  weekly: number | null = null,
  research: number | null = null,
) =>
  success(
    updateLocalAiUsagePolicy(emptyLocalAiUsageState(), {
      ...defaultLocalAiUsagePolicy(request.accountId),
      dailyRequestLimit: daily,
      weeklyRequestLimit: weekly,
      dailyResearchLimit: research,
    }),
  );

void test("zero limits block admissions but research-specific limits do not block tutor requests", () => {
  const denied = Effect.runSync(Effect.either(reserveLocalAiUsage(limited(0), request)));
  assert.ok(Either.isLeft(denied));
  assert.equal(denied.left._tag, "LocalAiBudgetExceeded");
  const state = success(reserveLocalAiUsage(limited(null, null, 0), request)).state;
  const research = Effect.runSync(
    Effect.either(
      reserveLocalAiUsage(state, { ...request, requestId: "research", task: "research" }),
    ),
  );
  assert.ok(Either.isLeft(research));
  if (research.left._tag === "LocalAiBudgetExceeded")
    assert.equal(research.left.kind, "daily-research");
  assert.equal(state.entries.length, 1);
});

void test("pending and failed requests consume budgets; UTC Monday resets both calendar windows", () => {
  const admitted = success(reserveLocalAiUsage(limited(1, 1), request)).state;
  const pending = Effect.runSync(
    Effect.either(reserveLocalAiUsage(admitted, { ...request, requestId: "pending" })),
  );
  assert.ok(Either.isLeft(pending));
  const failed = success(
    settleLocalAiUsage(admitted, {
      requestId: request.requestId,
      finishedAt: at,
      outcome: "failed",
      inputTokens: null,
      outputTokens: null,
    }),
  ).state;
  assert.ok(
    Either.isLeft(
      Effect.runSync(
        Effect.either(reserveLocalAiUsage(failed, { ...request, requestId: "failed-retry" })),
      ),
    ),
  );
  const nextWeek = success(
    reserveLocalAiUsage(failed, { ...request, requestId: "next-week", startedAt: at + 1 }),
  ).state;
  const current = success(summarizeLocalAiUsage(nextWeek, request.accountId, at + 1));
  assert.equal(current.daily.requests, 1);
  assert.equal(current.weekly.requests, 1);
  assert.equal(nextWeek.entries.length, 2);
});

void test("daily rollover preserves the weekly cap and reports its exact reset", () => {
  const monday = Date.parse("2026-10-05T12:00:00Z");
  const state = success(
    reserveLocalAiUsage(limited(1, 1), { ...request, startedAt: monday }),
  ).state;
  const denied = Effect.runSync(
    Effect.either(
      reserveLocalAiUsage(state, {
        ...request,
        requestId: "tuesday",
        startedAt: monday + 86400000,
      }),
    ),
  );
  assert.ok(Either.isLeft(denied));
  assert.equal(denied.left._tag, "LocalAiBudgetExceeded");
  assert.equal(denied.left.kind, "weekly-requests");
  assert.equal(denied.left.resetsAt, Date.parse("2026-10-12T00:00:00Z"));
});

void test("request identities cannot be reused across accounts and unrelated accounts have independent limits", () => {
  const initial = limited(1);
  const snapshot = JSON.stringify(initial);
  const state = success(reserveLocalAiUsage(initial, request)).state;
  const repeated = Effect.runSync(
    Effect.either(reserveLocalAiUsage(state, { ...request, accountId: "other" })),
  );
  assert.ok(Either.isLeft(repeated));
  assert.equal(repeated.left._tag, "LocalAiUsageInvalid");
  const other = success(
    reserveLocalAiUsage(state, { ...request, requestId: "other-request", accountId: "other" }),
  ).state;
  assert.equal(success(summarizeLocalAiUsage(other, request.accountId, at)).daily.requests, 1);
  assert.equal(success(summarizeLocalAiUsage(other, "other", at)).daily.requests, 1);
  assert.equal(JSON.stringify(initial), snapshot);
});

void test("missing usage stays unknown and known zero usage is counted without invention", () => {
  let state = success(reserveLocalAiUsage(emptyLocalAiUsageState(), request)).state;
  state = success(
    settleLocalAiUsage(state, {
      requestId: request.requestId,
      finishedAt: at,
      outcome: "completed",
      inputTokens: null,
      outputTokens: 5,
    }),
  ).state;
  state = success(reserveLocalAiUsage(state, { ...request, requestId: "zero" })).state;
  state = success(
    settleLocalAiUsage(state, {
      requestId: "zero",
      finishedAt: at,
      outcome: "completed",
      inputTokens: 0,
      outputTokens: 0,
    }),
  ).state;
  const summary = success(summarizeLocalAiUsage(state, request.accountId, at));
  assert.equal(summary.daily.unknownUsageRequests, 1);
  assert.equal(summary.daily.inputTokens, 0);
  assert.equal(summary.daily.outputTokens, 5);
});

void test("settlement is immutable and idempotent, rejects conflicting retries and invalid times", () => {
  const state = success(reserveLocalAiUsage(emptyLocalAiUsageState(), request)).state;
  const settlement = {
    requestId: request.requestId,
    finishedAt: at + 10,
    outcome: "completed",
    inputTokens: 20,
    outputTokens: 30,
  };
  const settled = success(settleLocalAiUsage(state, settlement)).state;
  assert.deepEqual(success(settleLocalAiUsage(settled, settlement)).state, settled);
  for (const invalid of [
    { ...settlement, outcome: "failed" },
    { ...settlement, outputTokens: 31 },
    { ...settlement, finishedAt: at - 1 },
    { ...settlement, requestId: "unknown" },
  ])
    assert.ok(Either.isLeft(Effect.runSync(Effect.either(settleLocalAiUsage(settled, invalid)))));
  assert.equal(state.entries[0]?.outcome, "pending");
});

void test("corrupt saved budgets fail closed rather than silently resetting history", () => {
  for (const raw of [
    "not json",
    "{}",
    JSON.stringify({
      version: 1,
      policies: [],
      entries: [
        {
          ...request,
          finishedAt: null,
          outcome: "completed",
          inputTokens: null,
          outputTokens: null,
        },
      ],
    }),
  ]) {
    const decoded = Effect.runSync(Effect.either(decodeLocalBudgetRecord(raw)));
    assert.ok(Either.isLeft(decoded));
    assert.match(decoded.left.message, /preserved/);
  }
  assert.deepEqual(success(decodeLocalBudgetRecord(null)), emptyLocalAiUsageState());
});

void test("budget form parser rejects exponent, fractions, signs and oversized values", () => {
  for (const text of ["1e3", "1.0", "-1", "+1", "1000001", "Infinity", "1 000"])
    assert.equal(parseLocalBudgetLimit(text), "invalid");
  assert.equal(parseLocalBudgetLimit("  "), null);
  assert.equal(parseLocalBudgetLimit(" 0 "), 0);
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 1000000 }), (value) => {
      assert.equal(parseLocalBudgetLimit(String(value)), value);
    }),
    { seed: 615, numRuns: 80 },
  );
});

void test("serialized budget transactions admit one concurrent request at the cap", async () => {
  let state: LocalAiUsageState = limited(1);
  const lock = Effect.runSync(Effect.makeSemaphore(1));
  const transaction: LocalBudgetTransaction = (update) =>
    lock.withPermits(1)(
      Effect.suspend(() =>
        update(state).pipe(
          Effect.map((result) => {
            state = result.state;
            return result.value;
          }),
        ),
      ),
    );
  const service = createLocalBudgetService(transaction);
  const results = await Effect.runPromise(
    Effect.all(
      [
        service.reserve(request).pipe(Effect.either),
        service.reserve({ ...request, requestId: "concurrent" }).pipe(Effect.either),
      ],
      { concurrency: "unbounded" },
    ),
  );
  assert.equal(results.filter(Either.isRight).length, 1);
  assert.equal(results.filter(Either.isLeft).length, 1);
  assert.equal(state.entries.length, 1);
});

void test("safe individual token counts cannot overflow aggregate summary totals", () => {
  let state = success(reserveLocalAiUsage(emptyLocalAiUsageState(), request)).state;
  state = success(
    settleLocalAiUsage(state, {
      requestId: request.requestId,
      finishedAt: at,
      outcome: "completed",
      inputTokens: Number.MAX_SAFE_INTEGER,
      outputTokens: 0,
    }),
  ).state;
  state = success(reserveLocalAiUsage(state, { ...request, requestId: "overflow" })).state;
  state = success(
    settleLocalAiUsage(state, {
      requestId: "overflow",
      finishedAt: at,
      outcome: "completed",
      inputTokens: 1,
      outputTokens: 0,
    }),
  ).state;
  const result = Effect.runSync(Effect.either(summarizeLocalAiUsage(state, request.accountId, at)));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, "usage-total-overflow");
});
