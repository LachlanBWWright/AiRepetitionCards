import assert from "node:assert/strict";
import test from "node:test";
import { Deferred, Effect, Either, Fiber } from "effect";
import {
  executeBudgetedTutorRequest,
  type LocalAiUsageReservation,
  type LocalAiUsageSettlement,
  type TutorBudgetDependencies,
  type TutorTransport,
} from "@recall/application";

function fixture() {
  const reservations: LocalAiUsageReservation[] = [];
  const settlements: LocalAiUsageSettlement[] = [];
  const dependencies: TutorBudgetDependencies = {
    budget: {
      reserve: (input) =>
        Effect.sync(() => {
          reservations.push(input);
        }),
      settle: (input) =>
        Effect.sync(() => {
          settlements.push(input);
        }),
    },
    now: () => 1234,
    createId: () => "request-id",
  };
  return { dependencies, reservations, settlements };
}
const request = { method: "POST", path: "/api/v1/tutor" } as const;
const transportFailure = { _tag: "TutorTransportError" } as const;

void test("tutor admission blocks unauthenticated and over-budget requests before transport", async () => {
  const state = fixture();
  let requests = 0;
  const transport: TutorTransport = () =>
    Effect.sync(() => {
      requests++;
      return { status: 200, body: null };
    });
  const anonymous = await Effect.runPromise(
    executeBudgetedTutorRequest(request, null, transport, state.dependencies),
  );
  assert.equal(anonymous.status, 401);
  assert.equal(state.reservations.length, 0);
  const denied = await Effect.runPromise(
    executeBudgetedTutorRequest(request, "owner", transport, {
      ...state.dependencies,
      budget: {
        ...state.dependencies.budget,
        reserve: () => Effect.fail({ _tag: "LocalBudgetFailure", message: "limit" }),
      },
    }),
  );
  assert.equal(denied.status, 429);
  assert.equal(requests, 0);
  assert.equal(state.settlements.length, 0);
});

void test("non-POST tutor requests bypass budget and account admission", async () => {
  const state = fixture();
  const response = await Effect.runPromise(
    executeBudgetedTutorRequest(
      { ...request, method: "PATCH" },
      null,
      () => Effect.succeed({ status: 200, body: "saved" }),
      state.dependencies,
    ),
  );
  assert.equal(response.body, "saved");
  assert.deepEqual(state.reservations, []);
  assert.deepEqual(state.settlements, []);
});

void test("tutor outcomes settle exactly once with injected identity and clock", async () => {
  for (const status of [200, 201, 400, 429, 503]) {
    const state = fixture();
    const response = await Effect.runPromise(
      executeBudgetedTutorRequest(
        request,
        "owner",
        () => Effect.succeed({ status, body: null }),
        state.dependencies,
      ),
    );
    assert.equal(response.status, status);
    assert.deepEqual(state.reservations, [
      {
        requestId: "request-id",
        accountId: "hosted:owner",
        model: "hosted-provider",
        task: "tutor",
        startedAt: 1234,
      },
    ]);
    assert.deepEqual(state.settlements, [
      {
        requestId: "request-id",
        finishedAt: 1234,
        outcome: status < 300 ? "completed" : "failed",
        inputTokens: null,
        outputTokens: null,
      },
    ]);
  }
});

void test("transport errors retain their type even when failure settlement is unavailable", async () => {
  const state = fixture();
  const result = await Effect.runPromise(
    Effect.either(
      executeBudgetedTutorRequest(request, "owner", () => Effect.fail(transportFailure), {
        ...state.dependencies,
        budget: {
          ...state.dependencies.budget,
          settle: () => Effect.fail({ _tag: "LocalBudgetFailure", message: "offline" }),
        },
      }),
    ),
  );
  assert.deepEqual(result, Either.left(transportFailure));
});

void test("a failed successful-response settlement returns a transport failure", async () => {
  const state = fixture();
  const result = await Effect.runPromise(
    Effect.either(
      executeBudgetedTutorRequest(
        request,
        "owner",
        () => Effect.succeed({ status: 200, body: null }),
        {
          ...state.dependencies,
          budget: {
            ...state.dependencies.budget,
            settle: () => Effect.fail({ _tag: "LocalBudgetFailure", message: "offline" }),
          },
        },
      ),
    ),
  );
  assert.deepEqual(result, Either.left(transportFailure));
});

void test("interrupting an admitted request settles its reservation as failed", async () => {
  const state = fixture();
  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<undefined>();
      const fiber = yield* Effect.fork(
        executeBudgetedTutorRequest(
          request,
          "owner",
          () => Deferred.succeed(started, undefined).pipe(Effect.zipRight(Effect.never)),
          state.dependencies,
        ),
      );
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
    }),
  );
  assert.equal(state.settlements.length, 1);
  assert.equal(state.settlements[0]?.outcome, "failed");
});
