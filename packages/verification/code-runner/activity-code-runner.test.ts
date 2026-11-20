import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either, Option } from "effect";
import { runBoundedDockerCommand } from "../../../apps/web/src/lib/learning/bounded-docker-command";
import { authorLearningActivity } from "@recall/application";
import { executeCodingActivity } from "../../../apps/web/src/lib/learning/code-runner";
const activity = await Effect.runPromise(
  authorLearningActivity({
    id: "code",
    areaId: "deck",
    title: "Sum",
    pluginId: "recall.coding",
    objectiveId: "sum",
    fields: { prompt: "Implement solve(values).", rubric: "Return the sum.", reference: "A fold." },
  }),
);
const response = {
  answers: ["function solve(values) { return values.reduce((a,b) => a+b,0); }"],
  selectedOptionIds: [],
  selfScore: 0.5,
  assistance: "none",
} as const;
await test("isolated code runner grades JSON test cases and does not execute in the host process", async () => {
  const result = await Effect.runPromise(executeCodingActivity(activity, response));
  assert.equal(result.passed, 3);
  assert.equal(result.total, 3);
  const wrong = await Effect.runPromise(
    executeCodingActivity(activity, { ...response, answers: ["function solve() { return 6; }"] }),
  );
  assert.equal(wrong.passed, 1);
});
await test("learner code cannot access Node capabilities or replace the result serializer", async () => {
  for (const source of [
    "function solve() { return process.env; }",
    "function solve() { return require('node:fs').readFileSync('/etc/passwd','utf8'); }",
    "JSON.stringify = () => '6'; function solve() { return 0; }",
    "function solve() { return ({}).constructor.constructor('return process')(); }",
  ]) {
    const result = await Effect.runPromise(
      executeCodingActivity(activity, { ...response, answers: [source] }),
    );
    assert.equal(result.passed, 0);
  }
});
await test("infinite learner code is bounded and invalid coding content fails before running", async () => {
  const result = await Effect.runPromise(
    executeCodingActivity(activity, {
      ...response,
      answers: ["function solve() { while(true) {} }"],
    }),
  );
  assert.equal(result.passed, 0);
  assert.ok(result.failures.every((message) => message.includes("timed out")));
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(
        Effect.either(executeCodingActivity({ ...activity, payload: {} }, response)),
      ),
    ),
  );
});

await test("Run selects public examples; Submit selects downloaded assessment tests", async () => {
  const configured = {
    ...activity,
    payload: { ...activity.payload, exampleTests: [{ input: [[1, 2, 3]], expected: 6 }] },
  };
  const constant = { ...response, answers: ["function solve() { return 6; }"] };
  const run = await Effect.runPromise(executeCodingActivity(configured, constant, "run"));
  const submit = await Effect.runPromise(executeCodingActivity(configured, constant, "submit"));
  assert.equal(run.total, 1);
  assert.equal(run.passed, 1);
  assert.equal(submit.total, 3);
  assert.equal(submit.passed, 1);
});

await test("Python and Rust solve functions receive JSON arguments and report compiler errors", async () => {
  for (const [language, source] of [
    ["python", "def solve(values):\n    return sum(values)"],
    [
      "rust",
      "fn solve(values: Value) -> Value { json!(values.as_array().unwrap().iter().map(|v| v.as_i64().unwrap()).sum::<i64>()) }",
    ],
  ] as const) {
    const configured = { ...activity, payload: { ...activity.payload, language } };
    const result = await Effect.runPromise(
      executeCodingActivity(configured, { ...response, answers: [source] }),
    );
    assert.equal(result.passed, 3, `${language} result: ${JSON.stringify(result)}`);
    assert.equal(result.status, "passed");
    const broken = await Effect.runPromise(
      executeCodingActivity(configured, { ...response, answers: ["this is invalid syntax !!!"] }),
    );
    assert.equal(broken.status, "error");
    assert.equal(broken.passed, 0);
    assert.ok(broken.failures[0]?.includes("Compilation"));
    assert.ok(broken.diagnostics?.length);
  }
});

await test("Python network, write, process and output abuse remain contained", async () => {
  const configured = { ...activity, payload: { ...activity.payload, language: "python" } };
  for (const source of [
    "def solve(values):\n    import socket\n    socket.create_connection(('1.1.1.1', 80), timeout=0.1)\n    return sum(values)",
    "def solve(values):\n    open('/runner/changed', 'w').write('bad')\n    return sum(values)",
    "def solve(values):\n    print('a' * 1000000)\n    return sum(values)",
    "def solve(values):\n    import subprocess\n    children = [subprocess.Popen(['sleep', '5']) for _ in range(40)]\n    return sum(values)",
  ]) {
    const result = await Effect.runPromise(
      executeCodingActivity(configured, { ...response, answers: [source] }),
    );
    assert.equal(result.passed, 0);
  }
  const timeout = await Effect.runPromise(
    executeCodingActivity(configured, {
      ...response,
      answers: ["def solve(values):\n    while True: pass"],
    }),
  );
  assert.equal(timeout.status, "timeout");
});

await test("Rust wrong answers and infinite execution use ordinary bounded results", async () => {
  const configured = { ...activity, payload: { ...activity.payload, language: "rust" } };
  const wrong = await Effect.runPromise(
    executeCodingActivity(configured, {
      ...response,
      answers: ["fn solve(_values: Value) -> Value { json!(false) }"],
    }),
  );
  assert.equal(wrong.passed, 0);
  assert.equal(wrong.status, "failed");
  const timeout = await Effect.runPromise(
    executeCodingActivity(configured, {
      ...response,
      answers: ["fn solve(_values: Value) -> Value { loop {} }"],
    }),
  );
  assert.equal(timeout.status, "timeout");
});

await test("cancellation removes the named execution container", async () => {
  const containers = () =>
    Effect.runPromise(
      runBoundedDockerCommand([
        "ps",
        "-a",
        "--filter",
        "name=recall-code-",
        "--format",
        "{{.Names}}",
      ]),
    );
  const before = await containers();
  const configured = { ...activity, payload: { ...activity.payload, language: "python" } };
  const cancelled = await Effect.runPromise(
    executeCodingActivity(configured, {
      ...response,
      answers: ["def solve(values):\n    while True: pass"],
    }).pipe(Effect.timeoutOption("750 millis")),
  );
  assert.ok(Option.isNone(cancelled));
  assert.equal(await containers(), before);
});
