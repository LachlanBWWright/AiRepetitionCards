import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import {
  assessLuaActivity,
  luaDraftResponse,
  startLuaActivity,
  unavailableLuaRuntime,
  updateLuaActivity,
  viewLuaActivity,
  type LuaRuntime,
} from "../../../application/src/activities/lua";

const payload = { script: "return {}", configuration: {}, seed: 7 };
const response = {
  answers: [],
  selectedOptionIds: [],
  selfScore: 0.5,
  assistance: "none",
} as const;
function runtime(): LuaRuntime {
  return {
    version: "acceptance-1",
    invoke: (request) => {
      if (request.operation === "init") return Effect.succeed(0);
      if (request.operation === "view")
        return Effect.succeed({ text: "Choose", buttons: [{ id: "advance", label: "Advance" }] });
      if (request.operation === "update")
        return Effect.succeed(typeof request.state === "number" ? request.state + 1 : 0);
      return Effect.succeed({
        complete: request.state === 1,
        score: request.state === 1 ? 1 : 0,
        feedback: "Replayed",
      });
    },
  };
}

await test("Lua assessment replays approved actions instead of trusting forged saved state", async () => {
  const executor = runtime();
  const started = await Effect.runPromise(startLuaActivity(payload, executor));
  const forged = luaDraftResponse(response, { ...started, state: 1 });
  const rejected = await Effect.runPromise(
    Effect.either(assessLuaActivity(payload, forged, executor)),
  );
  assert.ok(Either.isLeft(rejected));
  const completed = await Effect.runPromise(
    updateLuaActivity(payload, started, { id: "advance" }, executor),
  );
  const accepted = await Effect.runPromise(
    assessLuaActivity(payload, luaDraftResponse(response, { ...completed, state: 999 }), executor),
  );
  assert.equal(accepted.score, 1);
  assert.equal(started.events.length, 0);
});

await test("Lua rejects actions outside the current host view and mismatched runtime or seed", async () => {
  const executor = runtime();
  const started = await Effect.runPromise(startLuaActivity(payload, executor));
  const rejected = await Effect.runPromise(
    Effect.either(updateLuaActivity(payload, started, { id: "invented" }, executor)),
  );
  assert.ok(Either.isLeft(rejected));
  for (const changed of [
    { ...started, seed: 8 },
    { ...started, runtimeVersion: "old" },
  ]) {
    const assessed = await Effect.runPromise(
      Effect.either(assessLuaActivity(payload, luaDraftResponse(response, changed), executor)),
    );
    assert.ok(Either.isLeft(assessed));
    assert.equal(assessed.left.reason, "conflict");
  }
});

await test("Lua malformed executor views and unavailable execution preserve serialized drafts", async () => {
  const started = await Effect.runPromise(startLuaActivity(payload, runtime()));
  const saved = luaDraftResponse(response, started);
  const before = structuredClone(saved);
  const malformed: LuaRuntime = {
    version: "acceptance-1",
    invoke: () =>
      Effect.succeed({
        text: "Choose",
        buttons: [
          { id: "x", label: "One" },
          { id: "x", label: "Two" },
        ],
      }),
  };
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(Effect.either(viewLuaActivity(payload, started, malformed))),
    ),
  );
  assert.ok(
    Either.isLeft(
      await Effect.runPromise(Effect.either(startLuaActivity(payload, unavailableLuaRuntime))),
    ),
  );
  assert.deepEqual(saved, before);
});
