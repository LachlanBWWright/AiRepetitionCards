import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "../..");
const e2eRunner = path.join(root, "apps/web/scripts/run-e2e.mjs");
function invoke(script: string, args: readonly string[]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: { PATH: "", TZ: "UTC", RECALL_E2E_SKIP_BUILD: "1" },
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return { status: result.status, output: result.stdout + result.stderr };
}

void test("E2E help exits without builds, servers or browser dependencies", () => {
  const result = invoke(e2eRunner, ["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.output, /checks syntax only/);
  assert.doesNotMatch(result.output, /Chromium|vite|storybook build|TAP version/);
});

void test("E2E unknown flags and filenames fail before any runtime work", () => {
  for (const args of [
    ["--unknown"],
    ["missing.test.mjs"],
    ["--check", "missing.test.mjs"],
    ["--check", "--help"],
    ["--check", "../helpers.mjs"],
    ["--check", "/tmp/foreign.test.mjs"],
    ["offline-smoke.test.mjs", "missing.test.mjs"],
    ["--check", "--check"],
    ["offline-smoke.test.mjs", "offline-smoke.test.mjs"],
  ]) {
    const result = invoke(e2eRunner, args);
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.output, /No builds, servers or browsers started/);
    assert.doesNotMatch(result.output, /TAP version|Chromium|vite|storybook build/);
  }
});

void test("E2E syntax checks support selected known files without executing tests", () => {
  for (const args of [
    ["--check", "offline-smoke.test.mjs"],
    ["offline-smoke.test.mjs", "--check"],
  ]) {
    const result = invoke(e2eRunner, args);
    assert.equal(result.status, 0, result.output);
    assert.doesNotMatch(result.output, /TAP version|Chromium|vite|storybook build/);
  }
});

void test("both service-free regression runners reject unknown selections", () => {
  for (const runner of ["run.mjs", "run-local-integration.mjs"]) {
    for (const args of [["missing.test.ts"], ["../tests/scheduler.test.ts"], ["--help"]]) {
      const result = invoke(path.resolve(process.cwd(), "scripts", runner), args);
      assert.equal(result.status, 1);
      assert.match(result.output, /No regression checks found/);
      assert.doesNotMatch(result.output, /TAP version|Supabase|credential/i);
    }
  }
});
