import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { emptyActivityLibrary, type ActivityLibrary } from "@recall/domain";
import {
  acceptLearningAttempt,
  addLearningActivity,
  assessLearningActivity,
  authorLearningActivity,
  createActivityServices,
  decodeActivityLibrary,
  mergeActivityLibraries,
  reviseLearningActivity,
} from "@recall/application";

const activity = await Effect.runPromise(
  authorLearningActivity({
    id: "interactive-acceptance",
    areaId: "deck",
    title: "Retained response",
    pluginId: "recall.multiple-choice",
    objectiveId: "objective",
    fields: { prompt: "Choose", options: "Yes\nNo", correct: "1", reference: "Yes" },
  }),
);
const response = {
  answers: [],
  selectedOptionIds: ["1"],
  selfScore: 0.5,
  assistance: "none",
} as const;
const at = "2026-10-25T09:00:00.000Z";
const library: ActivityLibrary = {
  ...(await Effect.runPromise(addLearningActivity(emptyActivityLibrary, activity))),
  drafts: [
    {
      id: "completion",
      activity,
      response: { ...response, answers: ["learner draft"] },
      stage: 0,
      startedAt: at,
      updatedAt: at,
    },
  ],
};
const result = await Effect.runPromise(assessLearningActivity(activity, response));
const attempt = {
  id: "completion",
  activity,
  response,
  result,
  startedAt: at,
  submittedAt: at,
  acceptedAt: at,
};

await test("versioned unfinished responses survive serialization and a newer activity revision", async () => {
  const revised = await Effect.runPromise(
    reviseLearningActivity(library, { ...activity, title: "New question", revision: 2 }, 1),
  );
  const restored = await Effect.runPromise(
    decodeActivityLibrary(JSON.parse(JSON.stringify(revised))),
  );
  assert.equal(restored.version, 1);
  assert.equal(restored.activities[0]?.revision, 2);
  assert.deepEqual(restored.drafts?.[0], library.drafts?.[0]);
  const rejected = await Effect.runPromise(Effect.either(acceptLearningAttempt(restored, attempt)));
  assert.ok(Either.isLeft(rejected));
  assert.equal(rejected.left.reason, "conflict");
  assert.equal(restored.attempts.length, 0);
  assert.equal(restored.drafts?.[0]?.response.answers[0], "learner draft");
});

await test("assessment is provisional; acceptance retries and sync produce one immutable completion", async () => {
  const before = structuredClone(library);
  await Effect.runPromise(assessLearningActivity(activity, response));
  await Effect.runPromise(assessLearningActivity(activity, response));
  assert.deepEqual(library, before);
  const accepted = await Effect.runPromise(acceptLearningAttempt(library, attempt));
  const retried = await Effect.runPromise(acceptLearningAttempt(accepted, attempt));
  const merged = await Effect.runPromise(mergeActivityLibraries(retried, accepted));
  assert.equal(merged.attempts.length, 1);
  assert.equal(merged.drafts?.length, 0);
  const collision = await Effect.runPromise(
    Effect.either(
      acceptLearningAttempt(merged, {
        ...attempt,
        response: { ...response, answers: ["changed after completion"] },
      }),
    ),
  );
  assert.ok(Either.isLeft(collision));
  assert.equal(collision.left.reason, "conflict");
  assert.deepEqual(merged.attempts[0], attempt);
});

await test("a stale edit cannot replace current content or accepted historical evidence", async () => {
  const accepted = await Effect.runPromise(acceptLearningAttempt(library, attempt));
  const revised = await Effect.runPromise(
    reviseLearningActivity(accepted, { ...activity, revision: 2, title: "Current" }, 1),
  );
  const before = structuredClone(revised);
  const stale = await Effect.runPromise(
    Effect.either(
      reviseLearningActivity(revised, { ...activity, revision: 2, title: "Stale edit" }, 1),
    ),
  );
  assert.ok(Either.isLeft(stale));
  assert.equal(stale.left.reason, "conflict");
  assert.deepEqual(revised, before);
  assert.equal(revised.attempts[0]?.activity.revision, 1);
});

await test("unavailable assessment and forged evidence retain drafts without an accepted attempt", async () => {
  const before = structuredClone(library);
  const evidence = result.evidence[0];
  assert.ok(evidence);
  for (const reply of [
    { status: 503, body: { error: "Executor unavailable; keep your draft." } },
    { status: 200, body: { ...result, evidence: [{ ...evidence, objectiveId: "other-account" }] } },
    { status: 200, body: { ...result, evidence: [evidence, evidence] } },
  ]) {
    const services = createActivityServices(() => Effect.succeed(reply));
    const assessed = await Effect.runPromise(Effect.either(services.assess(activity, response)));
    assert.ok(Either.isLeft(assessed));
    assert.equal(assessed.left.reason, "assessment-unavailable");
    assert.deepEqual(library, before);
  }
});

await test("Run and Submit use explicit transport modes and execution alone never accepts history", async () => {
  const modes: unknown[] = [];
  const services = createActivityServices((request) => {
    assert.equal(request.path, "/api/v1/activities/execute");
    const body = request.body;
    assert.ok(typeof body === "object" && body !== null && "executionMode" in body);
    modes.push(body.executionMode);
    return Effect.succeed({ status: 200, body: { passed: 1, total: 1, failures: [] } });
  });
  const before = structuredClone(library);
  await Effect.runPromise(services.execute(activity, response, "run"));
  await Effect.runPromise(services.execute(activity, response, "submit"));
  await Effect.runPromise(services.execute(activity, response));
  assert.deepEqual(modes, ["run", "submit", "submit"]);
  assert.deepEqual(library, before);
  const unavailable = createActivityServices(() =>
    Effect.succeed({ status: 503, body: { error: "Executor unavailable" } }),
  );
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(Effect.either(unavailable.execute(activity, response, "run"))),
    ),
  );
  assert.deepEqual(library, before);
});
