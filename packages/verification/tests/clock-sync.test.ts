import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import fc from "fast-check";
import { Effect, Either, Schema } from "effect";
import {
  AccountIdSchema,
  createAreaId,
  createCardId,
  createDeviceId,
  createObjectiveId,
  createReviewEventId,
  type ReviewEvent,
  type Workspace,
} from "@recall/domain";
import { normalizeReviewTimestamp } from "@recall/contracts";
import { deriveEffectiveReviewTime, orderReviewEvents } from "@recall/sync-core";
import { newSchedule, schedulerParameterSetId } from "@recall/scheduler";
import {
  applyWorkspaceSyncChanges,
  reviewScheduleHash,
  type WorkspaceSyncChanges,
} from "@recall/application";

const time = "2026-10-03T12:00:00.000Z";
const areaId = createAreaId("00000000-0000-4000-8000-000000000001");
const cardId = createCardId("00000000-0000-4000-8000-000000000002");
const deviceId = createDeviceId("00000000-0000-4000-8000-000000000003");
const owner = Schema.decodeUnknownSync(AccountIdSchema)("00000000-0000-4000-8000-000000000004");
const objectiveId = createObjectiveId("00000000-0000-4000-8000-000000000005");
function review(id: string, at = time): ReviewEvent {
  return {
    id: createReviewEventId(id),
    areaId,
    cardId,
    ratedAt: at,
    reviewedAtDevice: at,
    effectiveReviewedAt: at,
    rating: "good",
    schedulerFamily: "fsrs",
    schedulerVersion: "ts-fsrs@5.4.2",
    schedulerParameterSetId: schedulerParameterSetId({ requestRetention: 0.9 }),
    deviceId,
    deviceSequence: 1,
    baseReviewEventId: null,
    elapsedMs: 1500,
    previousStateHash: "a".repeat(64),
  };
}

await test("timestamp validation rejects impossible calendar fields, year zero and invalid offsets", () => {
  for (const value of [
    "2025-02-29T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-00-01T00:00:00Z",
    "0000-01-01T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:60:00Z",
    "2026-01-01T00:00:60Z",
    "2026-01-01T00:00:00+14:01",
    "2026-01-01T00:00:00-15:00",
    "2026-01-01T00:00:00",
  ])
    assert.equal(normalizeReviewTimestamp(value), null, value);
  assert.equal(normalizeReviewTimestamp("2024-02-29T13:00:00+01:00"), "2024-02-29T12:00:00.000Z");
  assert.equal(normalizeReviewTimestamp("2026-01-01T14:00:00+14:00"), "2026-01-01T00:00:00.000Z");
});

await test("future timestamps clamp to reception while old offline evidence and raw device text survive", () => {
  const future = Effect.runSync(deriveEffectiveReviewTime("2027-01-01T13:00:00+01:00", time));
  assert.equal(future.reviewedAtDevice, "2027-01-01T13:00:00+01:00");
  assert.equal(future.effectiveReviewedAt, time);
  assert.equal(future.futureClamped, true);
  const old = Effect.runSync(deriveEffectiveReviewTime("2001-01-01T13:00:00+01:00", time));
  assert.equal(old.effectiveReviewedAt, "2001-01-01T12:00:00.000Z");
  assert.equal(old.futureClamped, false);
  const invalid = Effect.runSync(
    Effect.either(deriveEffectiveReviewTime("2026-02-30T00:00:00Z", time)),
  );
  assert.ok(Either.isLeft(invalid));
  assert.equal(invalid.left.reason, "invalid-device-time");
});

await test("causal parents precede earlier-clock children and concurrent branches retain both events", () => {
  const parent = review("parent");
  const child = {
    ...review("child", "2026-10-03T11:00:00.000Z"),
    deviceSequence: 2,
    baseReviewEventId: parent.id,
  };
  assert.deepEqual(
    orderReviewEvents([child, parent]).events.map((event) => event.id),
    [parent.id, child.id],
  );
  const sibling = {
    ...review("sibling"),
    deviceId: createDeviceId("00000000-0000-4000-8000-000000000006"),
  };
  const branches = orderReviewEvents([sibling, parent]);
  assert.equal(branches.events.length, 2);
  assert.equal(branches.concurrentEventIds.size, 2);
  const earlierOffset = review("earlier", "2026-10-03T13:00:00+02:00");
  assert.deepEqual(
    orderReviewEvents([parent, earlierOffset]).events.map((event) => event.id),
    [earlierOffset.id, parent.id],
  );
});

await test("schedule hash matches its versioned SHA-256 tuple and canonical timezone representation", () => {
  const schedule = newSchedule(new Date(time));
  const tuple = [
    "recall-fsrs-schedule-v1",
    schedule.due,
    schedule.stability,
    schedule.difficulty,
    schedule.elapsed_days,
    schedule.scheduled_days,
    schedule.learning_steps,
    schedule.reps,
    schedule.lapses,
    schedule.state,
    schedule.last_review ?? null,
  ];
  const expected = createHash("sha256").update(JSON.stringify(tuple)).digest("hex");
  assert.equal(Effect.runSync(reviewScheduleHash(schedule)), expected);
  assert.equal(
    Effect.runSync(reviewScheduleHash({ ...schedule, due: "2026-10-03T14:00:00+02:00" })),
    expected,
  );
  assert.notEqual(
    Effect.runSync(reviewScheduleHash({ ...schedule, reps: schedule.reps + 1 })),
    expected,
  );
});

function fixture(local: ReviewEvent): {
  readonly workspace: Workspace;
  readonly changes: WorkspaceSyncChanges;
} {
  const workspace: Workspace = {
    schemaVersion: 1,
    syncOwnerId: owner,
    syncDeviceId: deviceId,
    reviews: 1,
    reviewEvents: [local],
    pendingReviewEventIds: [local.id],
    syncCursor: "0",
    areas: [
      {
        id: areaId,
        title: "Clock evidence",
        color: "#123456",
        objectives: [{ id: objectiveId, title: "Goal", description: null, prerequisiteIds: [] }],
        cards: [
          {
            id: cardId,
            front: "Q",
            back: "A",
            objective: "Goal",
            objectiveIds: [objectiveId],
            schedule: newSchedule(new Date(time)),
          },
        ],
      },
    ],
  };
  return {
    workspace,
    changes: {
      baseline: workspace,
      acceptedIds: [local.id],
      cursor: "1",
      hasMore: false,
      uploadDeferred: false,
      pulledEvents: [],
      pulledAreas: workspace.areas,
      deletedCardIds: [],
      syncedAreaTombstoneIds: [],
      pulledDeletedAreaIds: [],
      contentHashes: {},
      conflicts: [],
    },
  };
}

await test("same-ID canonical receipts change derived time while preserving raw evidence and rejecting collisions", () => {
  const local = review("00000000-0000-4000-8000-000000000007", "2027-01-01T00:00:00.000Z");
  const { workspace, changes } = fixture(local);
  const canonical = { ...local, ratedAt: time, effectiveReviewedAt: time };
  const merged = Effect.runSync(
    applyWorkspaceSyncChanges(
      workspace,
      { ...changes, pulledEvents: [canonical] },
      () => "00000000-0000-4000-8000-000000000008",
    ),
  );
  assert.equal(merged.reviewEvents?.length, 1);
  assert.equal(merged.reviewEvents[0]?.reviewedAtDevice, local.reviewedAtDevice);
  assert.equal(merged.reviewEvents[0]?.effectiveReviewedAt, time);
  assert.equal(merged.pendingReviewEventIds?.length, 0);
  assert.equal(merged.areas[0]?.cards[0]?.schedule.last_review, time);
  const retried = Effect.runSync(
    applyWorkspaceSyncChanges(
      merged,
      { ...changes, pulledEvents: [canonical] },
      () => "00000000-0000-4000-8000-000000000008",
    ),
  );
  assert.deepEqual(retried, merged);
  const collisions: readonly ReviewEvent[] = [
    { ...canonical, rating: "again" },
    { ...canonical, areaId: createAreaId("other-area") },
    { ...canonical, cardId: createCardId("other-card") },
    { ...canonical, deviceId: createDeviceId("other-device") },
    { ...canonical, deviceSequence: 2 },
    { ...canonical, baseReviewEventId: createReviewEventId("other-parent") },
    { ...canonical, schedulerVersion: "future-version" },
    { ...canonical, schedulerParameterSetId: schedulerParameterSetId({ requestRetention: 0.8 }) },
    { ...canonical, previousStateHash: "b".repeat(64) },
    { ...canonical, elapsedMs: 1700 },
    { ...canonical, reviewedAtDevice: "2027-01-02T00:00:00.000Z" },
  ];
  for (const conflicting of collisions) {
    const result = Effect.runSync(
      Effect.either(
        applyWorkspaceSyncChanges(
          workspace,
          { ...changes, pulledEvents: [conflicting] },
          () => "00000000-0000-4000-8000-000000000008",
        ),
      ),
    );
    assert.ok(Either.isLeft(result));
    assert.equal(result.left.reason, "reviews");
  }
  assert.equal(workspace.reviewEvents?.[0]?.rating, "good");
});

await test("property: causal replay order is invariant under shuffled input", () => {
  fc.assert(
    fc.property(fc.shuffledSubarray([0, 1, 2, 3], { minLength: 4, maxLength: 4 }), (indices) => {
      const events = [0, 1, 2, 3].map((index) => ({
        ...review(`event-${String(index)}`),
        deviceSequence: index + 1,
        baseReviewEventId: index > 0 ? createReviewEventId(`event-${String(index - 1)}`) : null,
      }));
      const shuffled = indices.flatMap((index) => {
        const event = events[index];
        return event ? [event] : [];
      });
      assert.deepEqual(
        orderReviewEvents(shuffled).events.map((event) => event.id),
        events.map((event) => event.id),
      );
    }),
    { seed: 850, numRuns: 50 },
  );
});
