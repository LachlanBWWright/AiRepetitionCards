import assert from "node:assert/strict";
import test from "node:test";
import { signOutLocalChatGpt } from "../../../../apps/desktop/src/main/chatgpt/auth/chatgpt-local-sign-out";
import { createChatGptModelCatalog } from "../../../../apps/desktop/src/main/chatgpt/chatgpt-model-catalog";
import {
  fail,
  type LocalStore,
  type Reply,
} from "../../../../apps/desktop/src/main/chatgpt/transport/chatgpt-local-protocol";
const initial: LocalStore = {
  hostId: "test-host",
  activeClientId: "test-client",
  accounts: [
    {
      clientId: "test-client",
      subject: "test-subject",
      email: null,
      credentials: {
        accessToken: "test-access",
        refreshToken: "test-refresh",
        idToken: "test-id",
        expiresAt: 1000,
        scopes: ["chatgpt.tokens.use.direct"],
      },
    },
  ],
};
function fixture() {
  let stored = initial;
  return {
    load: (): Promise<Reply<LocalStore>> => Promise.resolve({ _tag: "Success", value: stored }),
    save: (next: LocalStore) => {
      stored = next;
      return Promise.resolve();
    },
    stored: () => stored,
  };
}
await test("desktop sign-out erases saved credentials before remote work and accepts a 204 revocation", async () => {
  const f = fixture();
  const calls: string[] = [];
  const request: typeof fetch = (url, init) => {
    assert.equal(f.stored().activeClientId, null);
    assert.deepEqual(f.stored().accounts, []);
    calls.push(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
    if (calls.length === 1)
      return Promise.resolve(
        Response.json({
          issuer: "https://auth.openai.com",
          revocation_endpoint: "https://auth.openai.com/revoke",
        }),
      );
    assert.equal(init?.method, "POST");
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  assert.deepEqual(await signOutLocalChatGpt("test-client", { ...f, request }), {
    _tag: "Success",
    value: { remoteRevocationConfirmed: true },
  });
  assert.equal(calls.length, 2);
});
await test("an offline or invalid remote revocation never restores desktop credentials", async () => {
  const responses: readonly (typeof fetch)[] = [
    () => Promise.reject(new TypeError("test offline")),
    () =>
      Promise.resolve(
        Response.json({
          issuer: "https://auth.openai.com",
          revocation_endpoint: "https://other.example/revoke",
        }),
      ),
  ];
  for (const request of responses) {
    const f = fixture();
    const result = await signOutLocalChatGpt("test-client", { ...f, request });
    assert.deepEqual(result, { _tag: "Success", value: { remoteRevocationConfirmed: false } });
    assert.deepEqual(f.stored().accounts, []);
  }
});
await test("remote revocation is bounded while local sign-out stays durable", async () => {
  const f = fixture();
  const request: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => {
          reject(new DOMException("test timeout", "AbortError"));
        },
        { once: true },
      );
    });
  // AbortSignal.timeout uses an unreferenced timer; keep the test process alive until it fires.
  const timer = setTimeout(() => undefined, 1000);
  try {
    const result = await signOutLocalChatGpt("test-client", {
      ...f,
      request,
      revocationTimeoutMs: 5,
    });
    assert.deepEqual(result, { _tag: "Success", value: { remoteRevocationConfirmed: false } });
    assert.deepEqual(f.stored().accounts, []);
  } finally {
    clearTimeout(timer);
  }
});
await test("a failed credential write reports failure and does not contact the provider", async () => {
  const f = fixture();
  let calls = 0;
  const result = await signOutLocalChatGpt("test-client", {
    ...f,
    save: () => Promise.reject(new Error("test storage failure")),
    request: () => {
      calls += 1;
      return Promise.resolve(new Response());
    },
  });
  assert.deepEqual(result, fail("credential-storage-failed"));
  assert.equal(calls, 0);
  assert.equal(f.stored(), initial);
});
await test("sign-out cancels an active catalog and prevents queued catalog fetches", async () => {
  let generation = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<Reply<T>>): Promise<Reply<T>> => {
    const result = queue.then(operation);
    queue = result;
    return result;
  };
  let started: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const catalog = createChatGptModelCatalog({
    generation: () => generation,
    serialize,
    models: (signal) =>
      new Promise((resolve) => {
        calls += 1;
        started();
        signal.addEventListener(
          "abort",
          () => {
            resolve(fail("inference-cancelled"));
          },
          { once: true },
        );
      }),
  });
  const first = catalog.read();
  const second = catalog.read();
  await pending;
  generation += 1;
  catalog.cancel();
  assert.deepEqual(await first, fail("inference-cancelled"));
  assert.deepEqual(await second, fail("inference-cancelled"));
  assert.equal(calls, 1);
});
