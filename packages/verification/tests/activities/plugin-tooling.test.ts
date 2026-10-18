import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import {
  applyActivityPluginMigration,
  authorLearningActivity,
  builtinActivityRegistry,
  decodeActivityPluginPayloadJson,
  exportUnsupportedActivity,
  inspectActivityPluginCompatibility,
  previewActivityPluginMigration,
  validateAuthoredActivity,
  type ActivityPlugin,
} from "@recall/application";

async function result<A, E>(effect: Effect.Effect<A, E>): Promise<Either.Either<A, E>> {
  return Effect.runPromise(Effect.either(effect));
}

const authored = await Effect.runPromise(
  authorLearningActivity({
    id: "plugin-tooling-activity",
    areaId: "area",
    title: "Explain a queue",
    pluginId: "recall.basic",
    objectiveId: "queues",
    fields: {
      prompt: "Explain a queue.",
      rubric: "Describe FIFO behavior.",
      reference: "A queue is first-in, first-out.",
    },
  }),
);

await test("plugin payload editor enforces bounded JSON object payloads", async () => {
  assert.ok(Either.isRight(await result(decodeActivityPluginPayloadJson('{"content":"safe"}'))));
  assert.ok(Either.isLeft(await result(decodeActivityPluginPayloadJson("[]"))));
  assert.ok(Either.isLeft(await result(decodeActivityPluginPayloadJson('"string"'))));
  assert.ok(Either.isLeft(await result(decodeActivityPluginPayloadJson("{"))));
  assert.ok(
    Either.isLeft(
      await result(decodeActivityPluginPayloadJson(`{"text":"${"x".repeat(100_001)}"}`)),
    ),
  );
});

await test("activity authoring checks installed plugin platform and assessment capabilities", async () => {
  const plugin = builtinActivityRegistry.find((entry) => entry.id === authored.pluginId);
  assert.ok(plugin);
  assert.equal(inspectActivityPluginCompatibility(plugin, "native", "self").compatible, true);
  const decoded = await result(validateAuthoredActivity(authored, "native", "self"));
  assert.ok(Either.isRight(decoded));
  const incompatible = await result(validateAuthoredActivity(authored, "web", "human"));
  assert.ok(Either.isLeft(incompatible));
  const unregistered = await result(
    validateAuthoredActivity({ ...authored, pluginId: "user.code" }, "web", "self"),
  );
  assert.ok(Either.isLeft(unregistered));
});

await test("migration preview is a proposal and approval checks the current activity", async () => {
  const original = builtinActivityRegistry.find((plugin) => plugin.id === authored.pluginId);
  assert.ok(original);
  const nextVersion: ActivityPlugin = {
    ...original,
    version: 2,
    migrate: (payload) => Effect.succeed(payload),
  };
  const registry = [...builtinActivityRegistry, nextVersion];
  const proposed = await result(previewActivityPluginMigration(authored, 2, registry));
  assert.ok(Either.isRight(proposed));
  if (Either.isLeft(proposed)) return;
  assert.equal(proposed.right.proposal.revision, authored.revision + 1);
  assert.equal(proposed.right.proposal.pluginVersion, 2);
  const declined = await result(
    applyActivityPluginMigration(authored, proposed.right, false, registry),
  );
  assert.ok(Either.isLeft(declined));
  const stale = await result(
    applyActivityPluginMigration({ ...authored, revision: 2 }, proposed.right, true, registry),
  );
  assert.ok(Either.isLeft(stale));
  const accepted = await result(
    applyActivityPluginMigration(authored, proposed.right, true, registry),
  );
  assert.ok(Either.isRight(accepted));
  if (Either.isRight(accepted)) assert.equal(accepted.right.pluginVersion, 2);
});

await test("unavailable plugin export keeps payload and readable fallback intact", async () => {
  const unknownActivity = { ...authored, pluginId: "third-party.missing", pluginVersion: 7 };
  const exported = await result(exportUnsupportedActivity(unknownActivity));
  assert.ok(Either.isRight(exported));
  if (Either.isRight(exported)) {
    assert.equal(exported.right.fallback, unknownActivity.fallback);
    assert.deepEqual(exported.right.activity.payload, unknownActivity.payload);
    assert.deepEqual(JSON.parse(exported.right.json), unknownActivity);
  }
});
