import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const config = resolve(process.cwd(), "../../apps/desktop/scripts/electron-builder.cjs");
function preflight(feed?: string, signed = true) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== "RECALL_DESKTOP_UPDATE_URL"),
  );
  return spawnSync(
    process.execPath,
    [
      "-e",
      `const c=require(${JSON.stringify(config)}); console.log(JSON.stringify(c.publish ?? null))`,
      "--",
      ...(signed ? ["-c.forceCodeSigning=true"] : []),
    ],
    {
      env: { ...environment, ...(feed === undefined ? {} : { RECALL_DESKTOP_UPDATE_URL: feed }) },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
}
await test("update feed is disabled by default and cannot be enabled on unsigned builds", () => {
  assert.equal(preflight().stdout.trim(), "null");
  assert.equal(preflight("https://updates.example.com/stable", false).status, 1);
  const enabled = preflight("https://updates.example.com/stable");
  // Windows also requires a protected publisher subject; macOS relies on the app signing identity.
  if (process.platform !== "win32") {
    assert.equal(enabled.status, 0);
    assert.deepEqual(JSON.parse(enabled.stdout), {
      provider: "generic",
      url: "https://updates.example.com/stable",
    });
  }
});
await test("update feed rejects insecure, credential-bearing and malformed addresses", () => {
  for (const feed of [
    "invalid",
    "http://updates.example.com",
    "https://user:pass@example.com",
    "https://example.com/?token=value",
    "https://example.com/#fragment",
  ]) {
    assert.equal(preflight(feed).status, 1, feed);
  }
});
