import assert from "node:assert/strict";
import test from "node:test";
import { authenticateSupabaseApiRequest } from "@recall/infra-supabase";
const owner = "00000000-0000-4000-8000-000000000007";
const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated", role: "authenticated" })}.Zml4dHVyZQ`;
const configuration = { url: "https://supabase.example.test", publishableKey: "fixture-key" };
const noCookies = () => {
  assert.fail("Bearer-authenticated clients must not require browser cookies");
};
await test("hosted clients authenticate bearer tokens and bind requests to the expected account", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.equal(url, "https://supabase.example.test/auth/v1/user");
    calls++;
    return Promise.resolve(
      Response.json({
        id: owner,
        aud: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: "2026-01-01T00:00:00Z",
      }),
    );
  };
  try {
    const result = await authenticateSupabaseApiRequest(
      new Request("https://recall.example.test/api/v1/tutor", {
        headers: { authorization: `Bearer ${token}`, "x-recall-workspace-owner": owner },
      }),
      configuration,
      noCookies,
    );
    assert.equal(result._tag, "Authenticated");
    assert.ok(calls > 0);
    const changed = await authenticateSupabaseApiRequest(
      new Request("https://recall.example.test/api/v1/tutor", {
        headers: {
          authorization: `Bearer ${token}`,
          "x-recall-workspace-owner": "00000000-0000-4000-8000-000000000008",
        },
      }),
      configuration,
      noCookies,
    );
    assert.deepEqual(changed, { _tag: "ContextError", reason: "workspace-account-changed" });
  } finally {
    globalThis.fetch = previous;
  }
});
await test("malformed bearer authentication is rejected before any cookie fallback", async () => {
  const result = await authenticateSupabaseApiRequest(
    new Request("https://recall.example.test/api/v1/tutor", {
      headers: { authorization: "not-a-bearer-token" },
    }),
    configuration,
    noCookies,
  );
  assert.deepEqual(result, { _tag: "ContextError", reason: "unauthenticated" });
});
