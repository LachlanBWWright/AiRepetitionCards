import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { createBrowserActivityServices } from "../../../../apps/web/src/lib/learning/activity-client";

await test("owner-bound browser requests retain the selected owner when the authenticated account changes", async (context) => {
  const owners: (string | null)[] = [];
  context.mock.method(globalThis, "fetch", (_input: unknown, init?: RequestInit) => {
    assert.ok(init);
    owners.push(new Headers(init.headers).get("x-recall-owner"));
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    return Promise.resolve(
      new Response(JSON.stringify({ error: "The selected account changed." }), {
        status: 401,
      }),
    );
  });
  const accountA = createBrowserActivityServices("account-a");
  const accountB = createBrowserActivityServices("account-b");
  for (const service of [accountA, accountB, accountA]) {
    const read = await Effect.runPromise(Effect.either(service.read));
    assert.ok(Either.isLeft(read));
    assert.equal(read.left.message, "The selected account changed.");
  }
  assert.deepEqual(owners, ["account-a", "account-b", "account-a"]);
});
