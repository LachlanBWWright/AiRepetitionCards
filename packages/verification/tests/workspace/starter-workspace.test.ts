import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { createStarterWorkspace, loadWorkspace, saveWorkspace } from "@recall/application";

const now = new Date("2026-11-06T00:00:00Z");
await test("starter decks have licensed real content, independent identities and fresh schedules", async () => {
  let id = 0;
  const create = () =>
    Effect.runPromise(createStarterWorkspace(now, () => `starter-${String(++id)}`));
  const first = await create();
  const second = await create();
  assert.deepEqual(
    first.areas.map((area) => [area.title, area.cards.length]),
    [
      ["Python", 127],
      ["Bicep", 50],
      ["OO Design", 6],
    ],
  );
  assert.equal(first.reviews, 0);
  assert.deepEqual(first.reviewEvents, []);
  const firstIds = new Set(
    first.areas.flatMap((area) => [area.id, ...area.cards.map((card) => card.id)]),
  );
  assert.ok(second.areas.every((area) => !firstIds.has(area.id)));
  for (const area of first.areas) {
    assert.ok(area.licence?.includes("creativecommons.org/licenses/by/4.0"));
    assert.ok(area.attribution?.includes("github.com"));
    assert.ok(
      area.cards.every(
        (card) =>
          card.front.trim() &&
          card.back.trim() &&
          card.schedule.reps === 0 &&
          card.schedule.due === now.toISOString(),
      ),
    );
  }
});

await test("saved deliberately empty workspaces remain Loaded rather than eligible for seeding", async () => {
  let stored: string | null = null;
  const store = {
    read: Effect.suspend(() => Effect.succeed(stored)),
    write: (value: string) =>
      Effect.sync(() => {
        stored = value;
      }),
    clear: Effect.void,
  };
  assert.equal((await Effect.runPromise(loadWorkspace(store)))._tag, "Empty");
  await Effect.runPromise(saveWorkspace(store, { schemaVersion: 1, reviews: 0, areas: [] }));
  const loaded = await Effect.runPromise(loadWorkspace(store));
  assert.equal(loaded._tag, "Loaded");
  assert.deepEqual(loaded.workspace.areas, []);
});

await test("starter identity failures are typed and do not produce a partial workspace", async () => {
  const result = await Effect.runPromise(Effect.either(createStarterWorkspace(now, () => "")));
  assert.ok(Either.isLeft(result));
  assert.equal(result.left._tag, "StarterWorkspaceUnavailable");
});
