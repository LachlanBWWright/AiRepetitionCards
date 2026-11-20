import { test } from "node:test";
import assert from "node:assert/strict";
import { execute } from "../runtime/execute.mjs";
const request = (script, extra = {}) => ({
  script,
  configuration: { value: 4 },
  seed: 12,
  operation: "init",
  ...extra,
});
test("deterministic init/update/view/assess JSON contract", async () => {
  const script = `return {
    init=function(c,seed) return {value=c.value,random=random(),seed=seed} end,
    update=function(s,e) return {value=s.value+e.amount} end,
    view=function(s) return {text=tostring(s.value)} end,
    assess=function(s) return {passed=s.value==5} end
  }`;
  const first = await execute(request(script));
  assert.equal(first.ok, true);
  assert.deepEqual(first, await execute(request(script)));
  assert.deepEqual(
    (
      await execute(
        request(script, { operation: "update", state: { value: 4 }, event: { amount: 1 } }),
      )
    ).value,
    { value: 5 },
  );
  assert.deepEqual(
    (await execute(request(script, { operation: "view", state: { value: 5 } }))).value,
    { text: "5" },
  );
  assert.deepEqual(
    (await execute(request(script, { operation: "assess", state: { value: 5 } }))).value,
    { passed: true },
  );
});
test("infinite loops finish and instruction budget is enforced", { timeout: 5000 }, async () => {
  const started = Date.now();
  const result = await execute(request("while true do end"));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "budget");
  assert.match(result.error.message, /instruction/);
  assert.ok(Date.now() - started < 3000);
});
test("forbidden APIs have no host bridge", async () => {
  const names = [
    "js",
    "require",
    "package",
    "io",
    "os",
    "debug",
    "load",
    "loadfile",
    "dofile",
    "print",
    "collectgarbage",
    "coroutine",
    "_G",
    "fetch",
    "process",
  ];
  for (const name of names) {
    const result = await execute(
      request(`return {init=function() return {missing=type(${name})=='nil'} end}`),
    );
    assert.deepEqual(result.value, { missing: true }, name);
  }
  assert.equal(
    (await execute(request("return {init=function() return require('js').global.process.env end}")))
      .ok,
    false,
  );
});
test("allocator rejects memory exhaustion with finite runtime", { timeout: 5000 }, async () => {
  const result = await execute(
    request('return {init=function() local s="x" for i=1,24 do s=s..s end return s end}'),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "budget");
  assert.match(result.error.message, /memory|alloc/i);
});
test("JSON validation, output size, depth and cycles are bounded", async () => {
  assert.equal(
    (await execute(request("return {}", { state: Infinity }))).error.code,
    "invalid-request",
  );
  assert.equal(
    (await execute(request("return {init=function() local t={} t.x=t return t end}"))).ok,
    false,
  );
  assert.equal(
    (await execute(request("return {init=function() return {x=function() end} end}"))).ok,
    false,
  );
  assert.equal(
    (
      await execute(
        request("return {init=function(c) return c end}", {
          configuration: { text: "x".repeat(33000) },
        }),
      )
    ).error.code,
    "budget",
  );
  const escaped = await execute(
    request("return {init=function(c) return c end}", {
      configuration: { text: 'quote" slash\\ newline\n unicode λ', n: null },
    }),
  );
  assert.deepEqual(escaped.value, { text: 'quote" slash\\ newline\n unicode λ', n: null });
});
