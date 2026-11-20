import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import {
  buildCodingAuthoringPayload,
  codingSubmissionResult,
  createActivityServices,
  type ActivityHttpRequest,
} from "@recall/application";
import type { ActivityResponse, LearningActivity } from "@recall/domain";

const response: ActivityResponse = {
  answers: ["function solve() { return 0; }"],
  selectedOptionIds: [],
  assistance: "none",
  selfScore: 0.5,
};
const activity: LearningActivity = {
  id: "coding",
  areaId: "area",
  title: "Sum",
  pluginId: "recall.coding",
  pluginVersion: 1,
  revision: 1,
  objectiveIds: ["objective"],
  fallback: "Sum values",
  payload: {},
};

await test("execution transports public run versus full submit and defaults to submit", async () => {
  const requests: ActivityHttpRequest[] = [];
  const services = createActivityServices((request) => {
    if (request.method === "POST") requests.push(request);
    return Effect.succeed({
      status: 200,
      body: { passed: 0, total: 1, failures: ["Wrong answer"], status: "failed" },
    });
  });
  const run = await Effect.runPromise(services.execute(activity, response, "run"));
  assert.equal(run.status, "failed");
  assert.equal(run.passed, 0);
  await Effect.runPromise(services.execute(activity, response));
  assert.deepEqual(
    requests.map((request) => request.body),
    [
      { activity, response, executionMode: "run" },
      { activity, response, executionMode: "submit" },
    ],
  );
  assert.ok(requests.every((request) => request.path === "/api/v1/activities/execute"));
});

await test("unavailable executor and malformed execution remain failures", async () => {
  for (const reply of [
    { status: 503, body: { error: "Unavailable" } },
    { status: 200, body: { passed: 2, total: 1, failures: [] } },
  ]) {
    const services = createActivityServices(() => Effect.succeed(reply));
    assert.ok(
      Either.isLeft(
        await Effect.runPromise(Effect.either(services.execute(activity, response, "run"))),
      ),
    );
  }
});

await test("submission proposes assisted ordinary failed result without modifying activity or response", () => {
  const assisted = { ...response, assistance: "hint" as const };
  const result = codingSubmissionResult(activity, assisted, {
    passed: 1,
    total: 2,
    failures: ["Wrong answer"],
  });
  assert.equal(result.evidence[0]?.score, 0.5);
  assert.equal(result.evidence[0].assistance, "hint");
  assert.match(result.feedback, /1\/2/);
  assert.equal(activity.revision, 1);
  assert.equal(assisted.answers[0], response.answers[0]);
});

await test("coding authoring validates language and downloaded examples at boundary", async () => {
  const base = {
    prompt: "Sum values",
    rubric: "Sum correctly",
    language: "python",
    starterCode: "def solve(values):\n    pass",
    tests: '[{"input":[[]],"expected":0}]',
    exampleTests: '[{"input":[[1]],"expected":1}]',
  };
  const payload = await Effect.runPromise(buildCodingAuthoringPayload(base));
  assert.equal(payload.language, "python");
  assert.equal(payload.exampleTests?.length, 1);
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(
        Effect.either(buildCodingAuthoringPayload({ ...base, language: "shell" })),
      ),
    ),
  );
});
