import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { readLocalChatGPTConnection } from "../../../../apps/web/src/components/tutor/connection/read-local-chatgpt-connection";
import { createLocalChatGPTConnectionStore } from "../../../../apps/web/src/components/tutor/connection/local-chatgpt-connection-store";

const account = (id: string) => ({
  clientId: id,
  label: "ChatGPT",
  email: null,
  signedIn: true,
  planEnabled: true,
});
const status = (id: string | null) => ({
  _tag: "Success",
  value: { enabled: true, activeClientId: id, accounts: id ? [account(id)] : [] },
});
const models = (slug: string) => ({ _tag: "Success", value: [{ slug, displayName: slug }] });
const createStore = () =>
  createLocalChatGPTConnectionStore({
    read: readLocalChatGPTConnection,
    onModels: () => undefined,
  });
function gate() {
  let release: (value: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

await test("startup readiness is cached for panels opened later", async () => {
  let statusCalls = 0;
  let modelCalls = 0;
  const bridge = {
    status: () => {
      statusCalls += 1;
      return Promise.resolve(status("saved"));
    },
    models: () => {
      modelCalls += 1;
      return Promise.resolve(models("study-model"));
    },
  };
  const store = createStore();
  await Effect.runPromise(store.ensure(bridge));
  const ready = store.getSnapshot();
  assert.equal(ready.checking, false);
  assert.equal(ready.state?.activeClientId, "saved");
  assert.equal(ready.models[0]?.slug, "study-model");
  await Effect.runPromise(store.ensure(bridge));
  await Effect.runPromise(store.ensure(bridge));
  assert.equal(store.getSnapshot(), ready);
  assert.equal(statusCalls, 2);
  assert.equal(modelCalls, 1);
});

await test("simultaneous startup and panel checks share one in-flight catalog request", async () => {
  const started = gate();
  const catalog = gate();
  let calls = 0;
  const bridge = {
    status: () => Promise.resolve(status("saved")),
    models: () => {
      calls += 1;
      started.release(null);
      return catalog.promise;
    },
  };
  const store = createStore();
  const first = Effect.runPromise(store.ensure(bridge));
  await started.promise;
  const others = [
    Effect.runPromise(store.ensure(bridge)),
    Effect.runPromise(store.refresh(bridge)),
  ];
  assert.equal(store.getSnapshot().checking, true);
  catalog.release(models("study-model"));
  await Promise.all([first, ...others]);
  assert.equal(calls, 1);
  assert.equal(store.getSnapshot().checking, false);
});

await test("an older account check cannot overwrite a replacement account", async () => {
  let owner = "first";
  const started = gate();
  const oldCatalog = gate();
  const bridge = {
    status: () => Promise.resolve(status(owner)),
    models: () => {
      if (owner === "first") {
        started.release(null);
        return oldCatalog.promise;
      }
      return Promise.resolve(models("second-model"));
    },
  };
  const store = createStore();
  const old = Effect.runPromise(store.ensure(bridge));
  await started.promise;
  owner = "second";
  store.invalidate();
  assert.equal(store.getSnapshot().state, null);
  assert.deepEqual(store.getSnapshot().models, []);
  await Effect.runPromise(store.ensure(bridge));
  oldCatalog.release(models("first-model"));
  await old;
  assert.equal(store.getSnapshot().state?.activeClientId, "second");
  assert.equal(store.getSnapshot().models[0]?.slug, "second-model");
});

await test("sign-out invalidates an in-flight model catalog", async () => {
  let owner: string | null = "saved";
  const started = gate();
  const catalog = gate();
  const bridge = {
    status: () => Promise.resolve(status(owner)),
    models: () => {
      started.release(null);
      return catalog.promise;
    },
  };
  const store = createStore();
  const old = Effect.runPromise(store.ensure(bridge));
  await started.promise;
  owner = null;
  store.invalidate();
  await Effect.runPromise(store.ensure(bridge));
  catalog.release(models("obsolete-model"));
  await old;
  assert.equal(store.getSnapshot().state?.activeClientId, null);
  assert.deepEqual(store.getSnapshot().models, []);
  assert.equal(store.getSnapshot().checking, false);
});

await test("catalog failures preserve the saved account and can recover on refresh", async () => {
  let failing = true;
  const bridge = {
    status: () => Promise.resolve(status("saved")),
    models: () =>
      Promise.resolve(
        failing ? { _tag: "Failure", code: "network-unavailable" } : models("recovered"),
      ),
  };
  const store = createStore();
  await Effect.runPromise(store.ensure(bridge));
  assert.equal(store.getSnapshot().state?.accounts[0]?.signedIn, true);
  assert.deepEqual(store.getSnapshot().models, []);
  assert.match(store.getSnapshot().message ?? "", /network/i);
  failing = false;
  await Effect.runPromise(store.refresh(bridge));
  assert.equal(store.getSnapshot().message, null);
  assert.equal(store.getSnapshot().models[0]?.slug, "recovered");
});

await test("status failures finish checking and remain retryable", async () => {
  let failing = true;
  const bridge = {
    status: () =>
      failing
        ? Promise.reject(new Error("temporarily unavailable"))
        : Promise.resolve(status("saved")),
    models: () => Promise.resolve(models("recovered")),
  };
  const store = createStore();
  const failure = await Effect.runPromise(Effect.either(store.ensure(bridge)));
  assert.equal(failure._tag, "Left");
  assert.equal(store.getSnapshot().checking, false);
  assert.match(store.getSnapshot().message ?? "", /status unavailable/i);
  failing = false;
  await Effect.runPromise(store.refresh(bridge));
  assert.equal(store.getSnapshot().models[0]?.slug, "recovered");
});

await test("superseded status failures cannot fail a newer healthy connection", async () => {
  const started = gate();
  const catalog = gate();
  let statusCalls = 0;
  const previousBridge = {
    status: () => {
      statusCalls += 1;
      return statusCalls === 1
        ? Promise.resolve(status("first"))
        : Promise.reject(new Error("old status unavailable"));
    },
    models: () => {
      started.release(null);
      return catalog.promise;
    },
  };
  const nextBridge = {
    status: () => Promise.resolve(status("second")),
    models: () => Promise.resolve(models("second-model")),
  };
  const store = createStore();
  const previous = Effect.runPromise(store.ensure(previousBridge));
  await started.promise;
  await Effect.runPromise(store.refresh(nextBridge, true));
  catalog.release(models("obsolete-model"));
  await previous;
  assert.equal(store.getSnapshot().state?.activeClientId, "second");
  assert.equal(store.getSnapshot().message, null);
  assert.equal(store.getSnapshot().models[0]?.slug, "second-model");
});
