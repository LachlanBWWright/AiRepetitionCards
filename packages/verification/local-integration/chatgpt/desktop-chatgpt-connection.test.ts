import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { readLocalChatGPTConnection } from "../../../../apps/web/src/components/tutor/connection/read-local-chatgpt-connection";
const account = {
  clientId: "client",
  label: "ChatGPT",
  email: null,
  signedIn: true,
  planEnabled: true,
};
const status = (signedIn: boolean) => ({
  _tag: "Success",
  value: {
    enabled: true,
    activeClientId: "client",
    accounts: [{ ...account, signedIn, planEnabled: signedIn }],
  },
});
await test("expired refresh tokens replace stale connected status with a reconnectable account", async () => {
  let signedIn = true;
  const snapshot = await Effect.runPromise(
    readLocalChatGPTConnection({
      status: () => Promise.resolve(status(signedIn)),
      models: () => {
        signedIn = false;
        return Promise.resolve({ _tag: "Failure", code: "invalid_grant", status: 400 });
      },
    }),
  );
  assert.equal(snapshot.state.accounts[0]?.signedIn, false);
  assert.equal(snapshot.state.accounts[0].planEnabled, false);
  assert.deepEqual(snapshot.models, []);
  assert.match(snapshot.message ?? "", /sign in again/);
});
await test("temporary catalog failures preserve a valid connection but do not report readiness", async () => {
  const snapshot = await Effect.runPromise(
    readLocalChatGPTConnection({
      status: () => Promise.resolve(status(true)),
      models: () => Promise.resolve({ _tag: "Failure", code: "network-unavailable" }),
    }),
  );
  assert.equal(snapshot.state.accounts[0]?.signedIn, true);
  assert.deepEqual(snapshot.models, []);
  assert.match(snapshot.message ?? "", /network/);
});
await test("a sign-out during model loading cannot resurrect ready models", async () => {
  let signedIn = true;
  const snapshot = await Effect.runPromise(
    readLocalChatGPTConnection({
      status: () =>
        Promise.resolve(
          signedIn
            ? status(true)
            : { _tag: "Success", value: { enabled: true, activeClientId: null, accounts: [] } },
        ),
      models: () => {
        signedIn = false;
        return Promise.resolve({
          _tag: "Success",
          value: [{ slug: "gpt-6-luna", displayName: "GPT-6 Luna" }],
        });
      },
    }),
  );
  assert.equal(snapshot.state.activeClientId, null);
  assert.deepEqual(snapshot.models, []);
});
await test("failure to recheck account status cannot return stale signed-in data", async () => {
  let reads = 0;
  const snapshot = await Effect.runPromise(
    Effect.either(
      readLocalChatGPTConnection({
        status: () =>
          Promise.resolve(
            ++reads === 1 ? status(true) : { _tag: "Failure", code: "credential-storage-failed" },
          ),
        models: () => Promise.resolve({ _tag: "Failure", code: "invalid_grant" }),
      }),
    ),
  );
  assert.ok(Either.isLeft(snapshot));
});
await test("a healthy account supplies models and an empty catalog explains recovery", async () => {
  const models = [{ slug: "gpt-6-luna", displayName: "GPT-6 Luna" }];
  for (const catalog of [models, []]) {
    const snapshot = await Effect.runPromise(
      readLocalChatGPTConnection({
        status: () => Promise.resolve(status(true)),
        models: () => Promise.resolve({ _tag: "Success", value: catalog }),
      }),
    );
    assert.deepEqual(snapshot.models, catalog);
    if (catalog.length) assert.equal(snapshot.message, null);
    else assert.match(snapshot.message ?? "", /No models.*Retry/);
  }
});
