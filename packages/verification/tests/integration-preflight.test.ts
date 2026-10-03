import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const script = path.resolve(process.cwd(), "scripts/run-integration.mjs");
const urlName = "RECALL_INTEGRATION_SUPABASE_URL";
const publicName = "RECALL_INTEGRATION_SUPABASE_PUBLISHABLE_KEY";
const serviceName = "RECALL_INTEGRATION_SUPABASE_SERVICE_ROLE_KEY";
const configured: Readonly<Record<string, string>> = {
  [urlName]: "http://127.0.0.1:54321",
  [publicName]: "sb_publishable_fixture_public_key_never_real",
  [serviceName]: "sb_secret_fixture_service_key_never_real",
};

function legacy(payload: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  return `${header}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.Zml4dHVyZS1zaWduYXR1cmU`;
}

/** Always config-only, with no inherited service configuration or suite arguments. */
function preflight(environment: Readonly<Record<string, string>>) {
  const result = spawnSync(process.execPath, [script, "--check-config"], {
    env: environment,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  const output = result.stdout + result.stderr;
  for (const name of [publicName, serviceName]) {
    const submitted = environment[name];
    if (submitted && submitted.trim())
      assert.ok(!output.includes(submitted), "submitted keys must remain private");
  }
  assert.ok(!output.includes("fixture_service_key_never_real"));
  assert.ok(!output.includes("fixture_public_key_never_real"));
  return { status: result.status, output };
}

void test("integration preflight accepts explicit loopback HTTP/HTTPS origins without contacting services", () => {
  for (const origin of [
    "http://localhost",
    "http://localhost:54321/",
    "https://localhost:443",
    "http://127.0.0.1:54321",
    "https://127.0.0.1/",
    "http://[::1]:54321",
    "https://[::1]/",
  ]) {
    const result = preflight({ ...configured, [urlName]: origin });
    assert.equal(result.status, 0, origin);
    assert.match(result.output, /configuration accepted; no services contacted/);
    assert.doesNotMatch(result.output, /tests|suites|SupabaseError/);
  }
});

void test("integration preflight accepts modern and legacy public/service-role pairs", () => {
  const publicKeys = [configured[publicName] ?? "", legacy({ role: "anon" })];
  const serviceKeys = [configured[serviceName] ?? "", legacy({ role: "service_role" })];
  for (const publicKey of publicKeys) {
    for (const serviceKey of serviceKeys) {
      assert.equal(
        preflight({ ...configured, [publicName]: publicKey, [serviceName]: serviceKey }).status,
        0,
      );
    }
  }
});

void test("integration preflight requires every configuration value explicitly and rejects whitespace", () => {
  assert.equal(preflight({}).status, 1);
  for (const name of Object.keys(configured)) {
    const missing = Object.fromEntries(Object.entries(configured).filter(([key]) => key !== name));
    assert.equal(preflight(missing).status, 1, name);
    for (const value of [
      "",
      " ",
      "\t\r\n",
      ` ${configured[name] ?? ""}`,
      `${configured[name] ?? ""}\n`,
    ]) {
      const result = preflight({ ...configured, [name]: value });
      assert.equal(result.status, 1, name);
      assert.match(result.output, /No integration checks ran/);
    }
  }
});

void test("integration preflight rejects malformed, remote and non-origin URLs", () => {
  for (const value of [
    "not-a-url",
    "//localhost:54321",
    "https://[::1",
    "http://localhost:99999",
    "file://localhost/",
    "ftp://localhost/",
    "https://fixture.supabase.co",
    "https://example.com",
    "http://192.168.1.2:54321",
    "http://127.0.0.2:54321",
    "http://[::2]:54321",
    "http://localhost.example.com:54321",
    "http://user:fixture-password@localhost:54321",
    "http://localhost:54321?token=fixture-query-secret",
    "http://localhost:54321#fixture-fragment-secret",
    "http://localhost:54321/rest/v1",
    "http://localhost:54321/%2F",
  ]) {
    const result = preflight({ ...configured, [urlName]: value });
    assert.equal(result.status, 1, value);
    assert.match(result.output, /No integration checks ran/);
    assert.ok(!result.output.includes(value));
    assert.ok(!result.output.includes("fixture-password"));
    assert.ok(!result.output.includes("fixture-query-secret"));
    assert.ok(!result.output.includes("fixture-fragment-secret"));
  }
});

void test("integration preflight rejects wrong key roles, malformed tokens and unsafe key text", () => {
  for (const name of [publicName, serviceName]) {
    const wrongRole = name === publicName ? "service_role" : "anon";
    const wrongModernKey = name === publicName ? configured[serviceName] : configured[publicName];
    for (const value of [
      wrongModernKey ?? "",
      legacy({ role: wrongRole }),
      legacy({ role: "authenticated" }),
      legacy({ role: 42 }),
      legacy({}),
      legacy(null),
      legacy(["anon"]),
      "not-a-key",
      "invalid.invalid.invalid",
      "sb_publishable_",
      "sb_secret_",
      legacy({ role: "anon" }).split(".").slice(0, 2).join("."),
      `.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`,
      `${legacy({ role: "anon" })}.extra`,
      legacy({ role: "service_role" }).replace(/^[^.]+/, "invalid!header"),
      "sb_publishable_fixture public key",
      "sb_secret_fixture\tservice",
      "sb_publishable_é_fixture",
      "sb_secret_🔑_fixture",
      `${name === publicName ? "sb_publishable_" : "sb_secret_"}${"x".repeat(8193)}`,
    ]) {
      const result = preflight({ ...configured, [name]: value });
      assert.equal(result.status, 1, name);
      assert.match(result.output, /No integration checks ran/);
    }
  }
});
