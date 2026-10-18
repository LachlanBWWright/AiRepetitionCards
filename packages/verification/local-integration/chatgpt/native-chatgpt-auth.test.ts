import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import {
  createChatGPTAuth,
  type ChatGPTAuthPorts,
  type ChatGPTAuthFailure,
} from "../../../../apps/mobile/src/storage/auth/chatgpt-auth.js";

const issuer = "https://auth.openai.com";
function fixture() {
  let saved: string | null = null;
  let now = 1800000000000;
  let random = 0;
  let opened = "";
  let stopped = 0;
  let signatureValid = true;
  let refreshStatus = 200;
  let failWrite = false;
  let callbackOverride: string | null = null;
  let subject = "subject-one";
  let issuedClient = "oaiapp_one";
  let mutateCallback = (value: string) => value;
  let scope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
  let tokenChanges: Readonly<Record<string, unknown>> = {};
  let claimsChanges: Readonly<Record<string, unknown>> = {};
  const calls: { readonly url: string; readonly form: Readonly<Record<string, string>> | null }[] =
    [];
  const credential = () => {
    const query = new URL(opened).searchParams;
    const claims = {
      iss: issuer,
      aud: issuedClient,
      sub: subject,
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 3600,
      nonce: query.get("nonce"),
      email: "same@example.test",
      ...claimsChanges,
    };
    return `${btoa(JSON.stringify({ alg: "RS256", kid: "key" }))}.${btoa(JSON.stringify(claims))}.signature`;
  };
  const ports: ChatGPTAuthPorts = {
    read: () => Effect.succeed(saved),
    write: (value) =>
      failWrite
        ? Effect.fail({ _tag: "ChatGPTAuthFailure", code: "credential-storage-failed" })
        : Effect.sync(() => {
            saved = value;
          }),
    random: () => Effect.sync(() => String(++random).padEnd(43, "x")),
    hostId: () => "a8dcc8b0-1809-4a62-b377-31d269b852a4",
    challenge: () => Effect.succeed("challenge".padEnd(43, "x")),
    now: () => now,
    start: () =>
      Effect.succeed({ id: "attempt", redirectUri: "http://127.0.0.1:54321/auth/callback" }),
    stop: () =>
      Effect.sync(() => {
        stopped += 1;
      }),
    callback: () =>
      Effect.sync(() =>
        mutateCallback(
          callbackOverride ??
            `http://127.0.0.1:54321/auth/callback?state=${new URL(opened).searchParams.get("state") ?? ""}&code=code&client_id=${issuedClient}`,
        ),
      ),
    open: (url) =>
      Effect.sync(() => {
        opened = url;
      }),
    request: (url, form) =>
      Effect.sync(() => {
        calls.push({ url, form });
        if (url.endsWith("jwks.json")) return { status: 200, body: { keys: [] } };
        if (url.endsWith("revoke")) return { status: refreshStatus, body: null };
        if (form?.grant_type === "refresh_token" && refreshStatus !== 200)
          return {
            status: refreshStatus,
            body: { error: refreshStatus === 400 ? "invalid_grant" : "temporary" },
          };
        return {
          status: 200,
          body: {
            access_token: form?.grant_type === "refresh_token" ? "refreshed-access" : "access",
            refresh_token: form?.grant_type === "refresh_token" ? "rotated-refresh" : "refresh",
            id_token: credential(),
            token_type: "Bearer",
            expires_in: 3600,
            scope,
            ...tokenChanges,
          },
        };
      }),
    verifySignature: () => Effect.succeed(signatureValid),
  };
  const auth = createChatGPTAuth(ports);
  return {
    auth,
    ports,
    calls,
    opened: () => new URL(opened),
    saved: () => saved,
    stopped: () => stopped,
    age: () => {
      now += 3600000;
    },
    setSignature: (value: boolean) => {
      signatureValid = value;
    },
    setResponse: (status: number) => {
      refreshStatus = status;
    },
    setCallback: (value: string) => {
      callbackOverride = value;
    },
    mutateCallback: (mutator: (value: string) => string) => {
      mutateCallback = mutator;
    },
    setClient: (value: string) => {
      issuedClient = value;
    },
    setSubject: (value: string) => {
      subject = value;
    },
    setScope: (value: string) => {
      scope = value;
    },
    setClaims: (value: Readonly<Record<string, unknown>>) => {
      claimsChanges = value;
    },
    setTokens: (value: Readonly<Record<string, unknown>>) => {
      tokenChanges = value;
    },
    failWrite: () => {
      failWrite = true;
    },
  };
}
const run = <A>(operation: Effect.Effect<A, ChatGPTAuthFailure>) => Effect.runPromise(operation);
const code = async <A>(operation: Effect.Effect<A, ChatGPTAuthFailure>) => {
  const result = await Effect.runPromise(Effect.either(operation));
  return Either.isLeft(result) ? result.left.code : null;
};

await test("native ChatGPT registration works without any Recall account or backend", async () => {
  const f = fixture();
  await run(f.auth.signIn());
  const params = f.opened().searchParams;
  assert.equal(params.get("client_id"), "dynamic_agent_client");
  assert.equal(params.get("agent_name_hint"), "Recall");
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.equal(params.get("redirect_uri"), "http://127.0.0.1:54321/auth/callback");
  assert.equal(params.get("ext_agent_host_id"), "urn:uuid:a8dcc8b0-1809-4a62-b377-31d269b852a4");
  assert.notEqual(params.get("state"), params.get("nonce"));
  const status = await run(f.auth.status);
  assert.equal(status.activeClientId, "oaiapp_one");
  assert.equal(status.accounts[0]?.planEnabled, true);
  assert.equal(JSON.stringify(status).includes("accessToken"), false);
  assert.equal(f.stopped(), 1);
  assert(f.calls.every((call) => call.url.startsWith(issuer)));
  assert.equal(
    f.calls.find((call) => call.form?.grant_type === "authorization_code")?.form?.client_id,
    "oaiapp_one",
  );
  assert.equal(await run(f.auth.accessToken("oaiapp_one")), "access");
});
await test("callback state, origin, duplicates, error/code combinations and client changes fail closed", async () => {
  for (const suffix of [
    "?state=wrong&code=code&client_id=oaiapp_one",
    "?state=x&state=x&code=code",
    "?error=access_denied&code=code",
  ]) {
    const f = fixture();
    f.setCallback(`http://127.0.0.1:54321/auth/callback${suffix}`);
    assert.notEqual(await code(f.auth.signIn()), null);
    assert.equal(f.calls.length, 0);
    assert.equal((await run(f.auth.status)).accounts.length, 0);
    assert.equal(f.stopped(), 1);
  }
  const f = fixture();
  f.setCallback("http://evil.test/auth/callback?state=x&code=code");
  assert.equal(await code(f.auth.signIn()), "invalid-callback");
});
await test("signature and identity claims are validated before storing credentials", async () => {
  for (const claims of [
    { iss: "https://evil.test" },
    { aud: "other-client" },
    { nonce: "wrong" },
    { exp: 1 },
    { iat: 99999999999 },
    { aud: ["oaiapp_one", "other"] },
    { nbf: 99999999999 },
  ]) {
    const f = fixture();
    f.setClaims(claims);
    assert.notEqual(await code(f.auth.signIn()), null);
    assert.equal((await run(f.auth.status)).accounts.length, 0);
  }
  const f = fixture();
  f.setSignature(false);
  assert.equal(await code(f.auth.signIn()), "invalid-identity-token");
  assert.equal((await run(f.auth.status)).accounts.length, 0);
});
await test("returning sign-in reuses registration/host and rejects another identity", async () => {
  const f = fixture();
  await run(f.auth.signIn());
  f.setSubject("different-subject");
  assert.equal(await code(f.auth.signIn("oaiapp_one", true)), "identity-mismatch");
  assert.equal(f.opened().searchParams.get("client_id"), "oaiapp_one");
  assert.equal(f.opened().searchParams.get("agent_name_hint"), null);
  assert.equal(f.opened().searchParams.get("prompt"), "consent");
  assert.equal(await run(f.auth.accessToken("oaiapp_one")), "access");
});
await test("rotating refresh is serialized and persisted before exposing renewed access", async () => {
  const f = fixture();
  await run(f.auth.signIn());
  f.age();
  const values = await Promise.all([
    run(f.auth.accessToken("oaiapp_one")),
    run(f.auth.accessToken("oaiapp_one")),
  ]);
  assert.deepEqual(values, ["refreshed-access", "refreshed-access"]);
  assert.equal(f.calls.filter((call) => call.form?.grant_type === "refresh_token").length, 1);
  assert(f.saved()?.includes("rotated-refresh"));
});
await test("temporary refresh failures preserve tokens; terminal failures clear tokens and retain registration", async () => {
  const f = fixture();
  await run(f.auth.signIn());
  f.age();
  f.setResponse(503);
  assert.equal(await code(f.auth.accessToken("oaiapp_one")), "provider-unavailable");
  assert.equal((await run(f.auth.status)).accounts[0]?.signedIn, true);
  f.setResponse(400);
  assert.equal(await code(f.auth.accessToken("oaiapp_one")), "session-expired");
  assert.equal((await run(f.auth.status)).accounts[0]?.signedIn, false);
  assert.equal((await run(f.auth.status)).accounts[0]?.clientId, "oaiapp_one");
});
await test("identity-only grants cannot be used for plan inference", async () => {
  const f = fixture();
  f.setScope("openid profile email");
  await run(f.auth.signIn());
  assert.equal((await run(f.auth.status)).accounts[0]?.planEnabled, false);
  assert.equal(await code(f.auth.accessToken("oaiapp_one")), "plan-permission-required");
});
await test("sign-out clears local credentials even when remote revocation fails", async () => {
  const f = fixture();
  await run(f.auth.signIn());
  f.setResponse(503);
  assert.deepEqual(await run(f.auth.signOut("oaiapp_one")), { remoteRevocationConfirmed: false });
  assert.equal((await run(f.auth.status)).accounts.length, 0);
  assert.equal(await code(f.auth.accessToken("oaiapp_one")), "account-changed");
});
await test("storage failures do not expose refreshed credentials", async () => {
  const f = fixture();
  await run(f.auth.signIn());
  f.age();
  f.failWrite();
  assert.equal(await code(f.auth.accessToken("oaiapp_one")), "credential-storage-failed");
});
await test("cancellation invalidates an in-flight sign-in before it can commit", async () => {
  const f = fixture();
  // Cancel this instance while its callback is pending.
  const cancelling = createChatGPTAuth({
    ...f.ports,
    callback: (id) =>
      Effect.gen(function* () {
        yield* cancelling.cancel();
        return yield* f.ports.callback(id);
      }),
  });
  assert.equal(await code(cancelling.signIn()), "account-changed");
  assert.equal((await run(cancelling.status)).accounts.length, 0);
});

await test("sign-in reuses the single connection; switching identity requires sign-out", async () => {
  const f = fixture();
  await run(f.auth.signIn());
  const host = f.opened().searchParams.get("ext_agent_host_id");
  await run(f.auth.signIn());
  assert.equal(f.opened().searchParams.get("client_id"), "oaiapp_one");
  assert.equal((await run(f.auth.status)).accounts.length, 1);
  await run(f.auth.signOut("oaiapp_one"));
  f.setClient("oaiapp_two");
  f.setSubject("subject-two");
  await run(f.auth.signIn());
  const status = await run(f.auth.status);
  assert.equal(status.accounts.length, 1);
  assert.equal(status.activeClientId, "oaiapp_two");
  assert.equal(status.accounts[0]?.label, "ChatGPT account");
  assert.equal(f.opened().searchParams.get("ext_agent_host_id"), host);
  assert.equal(await code(f.auth.accessToken("oaiapp_one")), "account-changed");
  const restored = createChatGPTAuth(f.ports);
  assert.deepEqual(await run(restored.status), status);
});
await test("exact callback validation rejects wrong path, duplicate code, errors and changed issued client", async () => {
  for (const mutate of [
    (value: string) => value.replace("/auth/callback", "/callback"),
    (value: string) => `${value}&code=second`,
    (value: string) => `${value}&error=access_denied`,
    (value: string) => `${value}&state=extra`,
    (value: string) => value.replace("127.0.0.1:54321", "127.0.0.1:54322"),
  ]) {
    const f = fixture();
    f.mutateCallback(mutate);
    assert.equal(await code(f.auth.signIn()), "invalid-callback");
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  await run(f.auth.signIn());
  f.setClient("oaiapp_wrong");
  assert.equal(await code(f.auth.signIn("oaiapp_one")), "invalid-callback");
  assert.equal((await run(f.auth.status)).activeClientId, "oaiapp_one");
});
await test("failed first exchange retains the issued registration for retry", async () => {
  const f = fixture();
  f.setTokens({ id_token: undefined });
  assert.equal(await code(f.auth.signIn()), "incomplete-token-response");
  f.setTokens({});
  await run(f.auth.signIn());
  assert.equal(f.opened().searchParams.get("client_id"), "oaiapp_one");
  assert.equal(f.opened().searchParams.get("agent_name_hint"), null);
});
await test("revocation clears the single connection and uses its registered client", async () => {
  const f = fixture();
  await run(f.auth.signIn());
  assert.deepEqual(await run(f.auth.signOut("oaiapp_one")), { remoteRevocationConfirmed: true });
  assert.equal((await run(f.auth.status)).accounts.length, 0);
  assert.equal(f.calls.find((call) => call.url.endsWith("revoke"))?.form?.client_id, "oaiapp_one");
});

await test("legacy multiple connections migrate to the active account without exposing other credentials", async () => {
  const f = fixture();
  const account = (clientId: string) => ({
    clientId,
    label: clientId,
    subject: clientId,
    email: "same@example.test",
    credentials: {
      accessToken: "access",
      refreshToken: "refresh",
      idToken: "identity",
      scopes: ["chatgpt.tokens.use.direct"],
      expiresAt: 1800003600000,
    },
  });
  let saved = JSON.stringify({
    version: 1,
    hostId: "urn:uuid:a8dcc8b0-1809-4a62-b377-31d269b852a4",
    activeClientId: "oaiapp_two",
    pendingClientId: null,
    accounts: [account("oaiapp_one"), account("oaiapp_two")],
  });
  const auth = createChatGPTAuth({
    ...f.ports,
    read: () => Effect.succeed(saved),
    write: (value) =>
      Effect.sync(() => {
        saved = value;
      }),
  });
  const status = await run(auth.status);
  assert.equal(status.activeClientId, "oaiapp_two");
  assert.equal(status.accounts.length, 1);
  assert.equal(status.accounts[0]?.clientId, "oaiapp_two");
  assert.equal(saved.includes("oaiapp_one"), false);
  assert.equal(await code(auth.accessToken("oaiapp_one")), "account-changed");
});
