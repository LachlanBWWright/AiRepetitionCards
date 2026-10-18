import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const script = path.resolve(process.cwd(), "../../apps/mobile/scripts/eas-release.mjs");
const token = "fixture-expo-access-token-never-real";
const publicKey = "sb_publishable_fixture_public_key_not_a_secret";
const configured: Readonly<Record<string, string>> = {
  EAS_PROJECT_ID: "00000000-0000-4000-8000-000000000001",
  EXPO_ACCOUNT_OWNER: "fixture-account",
  EXPO_TOKEN: token,
  EXPO_PUBLIC_RECALL_API_URL: "https://recall.example.com",
  EXPO_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
};
function preflight(
  environment: Readonly<Record<string, string>>,
  args = ["check", "production", "android"],
) {
  const result = spawnSync(process.execPath, [script, ...args], {
    env: environment,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  const output = result.stdout + result.stderr;
  assert.ok(!output.includes(token));
  assert.ok(!output.includes(publicKey));
  return { status: result.status, output };
}
await test("release preflight validates configuration without invoking a cloud build", () => {
  const result = preflight(configured);
  assert.equal(result.status, 0);
  assert.match(
    result.output,
    /Account access, project ownership and signing credentials still require Expo verification/,
  );
});
const cloudKeys = [
  "EXPO_PUBLIC_RECALL_API_URL",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;
const localOnly = Object.fromEntries(
  Object.entries(configured).filter(([name]) => !cloudKeys.some((key) => key === name)),
);
await test("local-only releases need Expo credentials without cloud configuration", () => {
  assert.equal(preflight(localOnly).status, 0);
  assert.equal(
    preflight({ ...localOnly, ...Object.fromEntries(cloudKeys.map((key) => [key, "  "])) }).status,
    0,
  );
  for (const key of ["EAS_PROJECT_ID", "EXPO_ACCOUNT_OWNER", "EXPO_TOKEN"])
    assert.equal(
      preflight(Object.fromEntries(Object.entries(localOnly).filter(([name]) => name !== key)))
        .status,
      1,
      key,
    );
});
await test("partial optional cloud configuration fails closed", () => {
  for (const key of cloudKeys)
    assert.equal(preflight({ ...localOnly, [key]: configured[key] ?? "" }).status, 1, key);
});
await test("missing release credentials fail closed without disclosing values", () => {
  for (const key of Object.keys(configured)) {
    const environment = Object.fromEntries(
      Object.entries(configured).filter(([name]) => name !== key),
    );
    assert.equal(preflight(environment).status, 1, key);
  }
});
await test("release project and owner must have valid bounded identities", () => {
  for (const [key, value] of [
    ["EAS_PROJECT_ID", "invented-project"],
    ["EXPO_ACCOUNT_OWNER", "owner/another"],
    ["EXPO_ACCOUNT_OWNER", "a".repeat(101)],
  ]) {
    assert.equal(preflight({ ...configured, [key ?? ""]: value ?? "" }).status, 1);
  }
});
await test("release endpoints reject HTTP, credentials, query fragments and loopback hosts", () => {
  const rejected = [
    "http://recall.example.com",
    "https://user:password@recall.example.com",
    "https://recall.example.com?token=secret",
    "https://recall.example.com#fragment",
    "https://localhost",
    "https://127.0.0.1",
    "https://127.0.0.2",
    "https://study.localhost",
    "https://[::1]",
  ];
  for (const key of ["EXPO_PUBLIC_RECALL_API_URL", "EXPO_PUBLIC_SUPABASE_URL"])
    for (const value of rejected)
      assert.equal(preflight({ ...configured, [key]: value }).status, 1, value);
});
await test("release preflight accepts only public Supabase keys", () => {
  const legacy = (role: string) =>
    `fixture.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.fixture`;
  assert.equal(
    preflight({ ...configured, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: legacy("anon") }).status,
    0,
  );
  for (const value of [
    legacy("service_role"),
    "sb_secret_fixture_not_public",
    "malformed-key",
    "sb_publishable_replace_me_000000000000",
  ])
    assert.equal(
      preflight({ ...configured, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: value }).status,
      1,
    );
});
await test("invalid release arguments cannot start an unintended build", () => {
  for (const args of [
    ["check", "production", "web"],
    ["check", "unknown", "android"],
    ["check"],
    ["submit", "production", "android"],
  ]) {
    const result = preflight(configured, args);
    assert.equal(result.status, 1);
    assert.match(result.output, /Usage:/);
  }
});
