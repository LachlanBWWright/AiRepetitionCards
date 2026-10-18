import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { Effect, Either } from "effect";
import {
  createAreaId,
  createAssessmentId,
  createDeviceId,
  createObjectiveId,
  type Workspace,
} from "@recall/domain";
import { captureCardVersion, deleteStudyCard, restoreCardVersion } from "@recall/application";
import { newSchedule } from "@recall/scheduler";
import { prepareWorkspaceForSync, stableSyncId } from "@recall/sync-core";

const now = new Date("2026-10-05T00:00:00.000Z");
const device = createDeviceId("00000000-0000-4000-8000-000000000099");
function success<A, E>(effect: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(effect));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}
function archived(seed: string): Workspace {
  const area = {
    id: createAreaId(`local-${seed}`),
    sourceId: `source-${seed}`,
    title: `Area ${seed}`,
    color: "#123456",
    objectives: [
      { id: createObjectiveId("parent"), title: "Parent", description: null, prerequisiteIds: [] },
      {
        id: createObjectiveId("child"),
        title: "Child",
        description: null,
        prerequisiteIds: [createObjectiveId("parent")],
      },
    ],
    cards: [
      {
        id: createAssessmentId("local-card"),
        sourceId: "upstream-card",
        front: "Question",
        back: "Answer",
        objective: "Child",
        objectiveIds: [createObjectiveId("child")],
        schedule: newSchedule(now),
      },
    ],
  };
  const card = area.cards[0];
  assert.ok(card);
  return captureCardVersion(
    { schemaVersion: 1, syncDeviceId: device, reviews: 0, areas: [] },
    area,
    card,
    "delete",
    now,
  );
}
const seeds = fc.stringMatching(/^[a-z][a-z0-9]{0,15}$/);

await test("historical-only identities normalize deterministically without changing provenance or snapshot evidence", () => {
  fc.assert(
    fc.property(seeds, (seed) => {
      const input = archived(seed);
      const before = JSON.stringify(input);
      const normalized = prepareWorkspaceForSync(input, () => device);
      const original = input.cardVersions?.[0];
      const version = normalized.cardVersions?.[0];
      assert.ok(original && version);
      assert.equal(version.id, original.id);
      assert.equal(version.recordedAt, original.recordedAt);
      assert.equal(version.reason, original.reason);
      assert.equal(version.areaId, stableSyncId(`area:source-${seed}`));
      assert.equal(version.cardId, stableSyncId(`card:source-${seed}:upstream-card`));
      assert.equal(version.area.sourceId, original.area.sourceId);
      assert.equal(version.card.sourceId, original.card.sourceId);
      assert.deepEqual(version.card.schedule, original.card.schedule);
      const parent = version.area.objectives?.find((item) => item.title === "Parent");
      const child = version.area.objectives?.find((item) => item.title === "Child");
      assert.ok(parent && child);
      assert.deepEqual(child.prerequisiteIds, [parent.id]);
      assert.deepEqual(version.card.objectiveIds, [child.id]);
      assert.equal(JSON.stringify(input), before);
      assert.deepEqual(
        prepareWorkspaceForSync(normalized, () => device),
        normalized,
      );
    }),
    { numRuns: 100, seed: 20261005 },
  );
});

await test("same legacy card and objective aliases stay scoped to different historical areas regardless of version order", () => {
  fc.assert(
    fc.property(fc.uniqueArray(seeds, { minLength: 2, maxLength: 12 }), (values) => {
      const versions = values.flatMap((seed) => archived(seed).cardVersions ?? []);
      const input: Workspace = {
        schemaVersion: 1,
        syncDeviceId: device,
        reviews: 0,
        areas: [],
        cardVersions: versions,
      };
      const normalized = prepareWorkspaceForSync(input, () => device);
      const reversed = prepareWorkspaceForSync(
        { ...input, cardVersions: [...versions].reverse() },
        () => device,
      );
      assert.equal(
        new Set(normalized.cardVersions?.map((version) => version.cardId)).size,
        values.length,
      );
      const byId = new Map(
        reversed.cardVersions?.map((version) => [version.area.sourceId, version]),
      );
      for (const version of normalized.cardVersions ?? [])
        assert.deepEqual(byId.get(version.area.sourceId), version);
    }),
    { numRuns: 80, seed: 20261006 },
  );
});

await test("normalized archived deletions restore content and prerequisites with normalized identities", () => {
  fc.assert(
    fc.property(seeds, (seed) => {
      const historical = archived(seed);
      const version = historical.cardVersions?.[0];
      assert.ok(version);
      const live: Workspace = {
        ...historical,
        areas: [{ ...version.area, cards: [version.card] }],
      };
      const deleted = success(
        deleteStudyCard(live, { areaId: version.areaId, cardId: version.cardId }, now),
      );
      const normalized = prepareWorkspaceForSync(deleted, () => device);
      const snapshot = normalized.cardVersions?.[0];
      assert.ok(snapshot);
      const restored = success(
        restoreCardVersion(
          normalized,
          { areaId: snapshot.areaId, cardId: snapshot.cardId, versionId: snapshot.id },
          now,
        ),
      );
      assert.equal(restored.areas[0]?.cards[0]?.id, snapshot.cardId);
      assert.equal(restored.areas[0].cards[0].front, snapshot.card.front);
      assert.deepEqual(restored.areas[0].cards[0].objectiveIds, snapshot.card.objectiveIds);
      assert.deepEqual(restored.areas[0].objectives, snapshot.area.objectives);
      assert.deepEqual(restored.deletedCards, []);
    }),
    { numRuns: 80, seed: 20261007 },
  );
});
