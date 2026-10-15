import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either, Schema } from "effect";
import {
  ActivityJsonSchema,
  ActivityLibrarySchema,
  parseWorkspaceJson,
  type ActivityJson,
} from "@recall/domain";

const activity = {
  id: "bounded-json",
  areaId: "deck",
  title: "Portable extension",
  pluginId: "extension.example",
  pluginVersion: 1,
  revision: 1,
  objectiveIds: ["objective"],
  fallback: "Content is retained when its plugin is unavailable.",
};

await test("workspace JSON rejects deeply nested plugin content as an expected shape failure", async () => {
  const nested = `${"[".repeat(12_000)}null${"]".repeat(12_000)}`;
  const raw = `{"schemaVersion":1,"areas":[],"reviews":0,"activityLibrary":{"version":1,"activities":[{${JSON.stringify(activity).slice(1, -1)},"payload":{"nested":${nested}}}],"attempts":[]}}`;
  const outcome = await Effect.runPromise(Effect.either(parseWorkspaceJson(raw)));
  assert.ok(Either.isLeft(outcome));
  assert.equal(outcome.left.reason, "invalid-shape");
});

await test("activity JSON rejects cycles, excessive breadth and non-JSON values without recursive traversal", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const input of [
    cyclic,
    Array.from({ length: 50_001 }, () => null),
    NaN,
    new Date(),
    [undefined],
  ]) {
    assert.ok(Either.isLeft(Schema.decodeUnknownEither(ActivityJsonSchema)(input)));
  }
});

await test("bounded nested plugin content survives a workspace backup round trip", async () => {
  let nested: ActivityJson = { value: "kept", list: [1, false, null] };
  for (let depth = 0; depth < 12; depth += 1) nested = { nested };
  const library = { version: 1, activities: [{ ...activity, payload: { nested } }], attempts: [] };
  assert.ok(Either.isRight(Schema.decodeUnknownEither(ActivityLibrarySchema)(library)));
  const raw = JSON.stringify({ schemaVersion: 1, areas: [], reviews: 0, activityLibrary: library });
  const outcome = await Effect.runPromise(Effect.either(parseWorkspaceJson(raw)));
  assert.ok(Either.isRight(outcome));
  assert.ok("activityLibrary" in outcome.right);
  assert.deepEqual(outcome.right.activityLibrary, library);
});
