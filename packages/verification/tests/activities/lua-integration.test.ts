import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import {
  buildLuaAuthoringPayload,
  createLuaHttpRuntime,
  LUA_RUNTIME_VERSION,
  decodeLuaPayload,
  decodeLuaView,
} from "../../../application/src/activities/lua";

await test("Lua transport uses authenticated activity transport envelope and validates runtime version", async () => {
  const payload = { script: "return {}", configuration: {}, seed: 0, operation: "init" as const };
  const runtime = createLuaHttpRuntime((request) => {
    assert.equal(request.path, "/api/v1/activities/lua");
    assert.equal(request.method, "POST");
    assert.deepEqual(request.body, payload);
    return Effect.succeed({
      status: 200,
      body: { value: { count: 0 }, runtimeVersion: LUA_RUNTIME_VERSION },
    });
  });
  assert.deepEqual(await Effect.runPromise(runtime.invoke(payload)), { count: 0 });
  const changed = createLuaHttpRuntime(() =>
    Effect.succeed({ status: 200, body: { value: {}, runtimeVersion: "changed" } }),
  );
  const result = await Effect.runPromise(Effect.either(changed.invoke(payload)));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left.reason, "conflict");
  const unavailable = createLuaHttpRuntime(() =>
    Effect.succeed({ status: 503, body: { error: "Runner unavailable" } }),
  );
  const failed = await Effect.runPromise(Effect.either(unavailable.invoke(payload)));
  assert.ok(Either.isLeft(failed));
  assert.equal(failed.left.message, "Runner unavailable");
});

await test("Lua authoring validates explicit fallback, bounded object configuration and seed", async () => {
  const authored = await Effect.runPromise(buildLuaAuthoringPayload({}));
  assert.ok(authored.script.includes("init"));
  for (const fields of [
    { fallback: " " },
    { configuration: "[]" },
    { configuration: "invalid" },
    { seed: "1.5" },
  ]) {
    const result = await Effect.runPromise(Effect.either(buildLuaAuthoringPayload(fields)));
    assert.ok(Either.isLeft(result));
  }
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const invalid = await Effect.runPromise(
    Effect.either(decodeLuaPayload({ script: "return {}", configuration: cyclic })),
  );
  assert.ok(Either.isLeft(invalid));
});

await test("Lua empty-table buttons normalize without admitting malformed host controls", async () => {
  assert.deepEqual(await Effect.runPromise(decodeLuaView({ text: "Finished", buttons: {} })), {
    text: "Finished",
    buttons: [],
  });
  const result = await Effect.runPromise(
    Effect.either(decodeLuaView({ text: "Broken", buttons: { injected: "control" } })),
  );
  assert.ok(Either.isLeft(result));
});
