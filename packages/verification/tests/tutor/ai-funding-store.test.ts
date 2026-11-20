import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import {
  createAiFundingStore,
  managedAiUnavailableReason,
  type AiFundingPorts,
} from "@recall/application";
const owner = "00000000-0000-4000-8000-000000000007";
const status = {
  schemaVersion: 1 as const,
  accountId: owner,
  available: true,
  dailyLimitMicrousd: 10000,
  usedMicrousd: 0,
  requestLimit: 30,
  requestsUsed: 0,
  expiresAt: null,
};
const ports: AiFundingPorts = {
  read: () => Effect.succeed(null),
  write: () => Effect.void,
  status: () => Effect.succeed(status),
};
function gate<A>() {
  let release: (value: A) => void = () => {};
  const promise = new Promise<A>((resolve) => {
    release = resolve;
  });
  return {
    effect: Effect.promise(() => promise),
    release: (value: A) => {
      release(value);
    },
  };
}
await test("managed availability never automatically selects managed funding", async () => {
  const store = createAiFundingStore(owner, ports);
  await Effect.runPromise(store.initialize);
  assert.equal(store.getSnapshot().mode, "byo");
  assert.equal(managedAiUnavailableReason(store.getSnapshot()), null);
});
await test("saved account preference restores independently of status refresh", async () => {
  const saved = gate<string | null>();
  const store = createAiFundingStore(owner, { ...ports, read: () => saved.effect });
  const pending = Effect.runPromise(store.initialize);
  await Effect.runPromise(store.refresh());
  saved.release("managed");
  await pending;
  assert.equal(store.getSnapshot().mode, "managed");
  assert.equal(store.getSnapshot().checking, false);
});
await test("failed preference persistence cannot switch funding", async () => {
  const store = createAiFundingStore(owner, {
    ...ports,
    write: () => Effect.fail({ message: "Storage failed" }),
  });
  await Effect.runPromise(store.initialize);
  await Effect.runPromise(store.select("managed"));
  assert.equal(store.getSnapshot().mode, "byo");
  assert.equal(managedAiUnavailableReason(store.getSnapshot()), "Storage failed");
});
await test("an explicit selection wins over a late saved preference read", async () => {
  const saved = gate<string | null>();
  const store = createAiFundingStore(owner, { ...ports, read: () => saved.effect });
  const pending = Effect.runPromise(store.initialize);
  await Effect.runPromise(store.select("managed"));
  saved.release("byo");
  await pending;
  assert.equal(store.getSnapshot().mode, "managed");
});
await test("disposed accounts cannot publish late availability or preferences", async () => {
  const delayed = gate<typeof status>();
  const old = createAiFundingStore(owner, { ...ports, status: () => delayed.effect });
  const pending = Effect.runPromise(old.initialize);
  old.dispose();
  const nextOwner = "00000000-0000-4000-8000-000000000008";
  const next = createAiFundingStore(nextOwner, {
    ...ports,
    status: () => Effect.succeed({ ...status, accountId: nextOwner }),
  });
  await Effect.runPromise(next.initialize);
  delayed.release(status);
  await pending;
  assert.equal(old.getSnapshot().status, null);
  assert.equal(next.getSnapshot().mode, "byo");
  assert.equal(next.getSnapshot().status?.accountId, nextOwner);
});
await test("effect cleanup and remount can safely reuse the same store", async () => {
  const store = createAiFundingStore(owner, { ...ports, read: () => Effect.succeed("managed") });
  await Effect.runPromise(store.initialize);
  store.dispose();
  await Effect.runPromise(store.initialize);
  assert.equal(store.getSnapshot().mode, "managed");
  assert.equal(store.getSnapshot().checking, false);
});
await test("foreign status and exhausted budgets never authorize managed requests", async () => {
  for (const supplied of [
    { ...status, accountId: "other" },
    { ...status, requestsUsed: 30 },
    { ...status, usedMicrousd: 10000 },
  ]) {
    const store = createAiFundingStore(owner, { ...ports, status: () => Effect.succeed(supplied) });
    await Effect.runPromise(store.initialize);
    assert.ok(managedAiUnavailableReason(store.getSnapshot()));
  }
});
await test("anonymous BYO use does not fetch managed allowances or persist a grant", async () => {
  let calls = 0;
  const store = createAiFundingStore(null, {
    ...ports,
    status: () => {
      calls++;
      return Effect.succeed(status);
    },
  });
  await Effect.runPromise(store.initialize);
  await Effect.runPromise(store.select("managed"));
  assert.equal(calls, 0);
  assert.equal(store.getSnapshot().mode, "byo");
  assert.match(managedAiUnavailableReason(store.getSnapshot()) ?? "", /Sign in/);
});
