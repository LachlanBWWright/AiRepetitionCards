import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  createReviewEventId,
  type Workspace,
} from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import {
  prepareWorkspaceForSync,
  repairReviewSyncConflicts,
  stableSyncId,
} from "@recall/sync-core";
const areaId = createAreaId("legacy-area");
const cardId = createAssessmentId("legacy-card");
const objectiveId = createObjectiveId("legacy-objective");
const eventId = createReviewEventId("legacy-event");
const now = "2026-10-20T00:00:00.000Z";
const deviceId = "00000000-0000-4000-8000-000000000001";
function workspace(): Workspace {
  const schedule = newSchedule(new Date(now));
  const baseline = { schedule, reviewEventIds: [eventId] };
  const settings = {
    requestRetention: 0.9,
    areaReviewLimits: { [areaId]: 7 },
    dailyLimitOverrides: [
      {
        areaId,
        startsAt: Date.parse(now),
        endsAt: Date.parse(now) + 86400000,
        dailyReviewLimit: 11,
      },
    ],
  };
  const importedSchedules = [{ areaId, cardId, baseline }];
  return {
    schemaVersion: 1,
    reviews: 1,
    schedulerSettings: settings,
    importedScheduleBaselines: importedSchedules,
    syncStudyBaseline: {
      settings,
      importedSchedules,
      adjustments: [],
      corrections: [],
      undoStates: [],
    },
    areas: [
      {
        id: areaId,
        title: "Legacy",
        color: "#123456",
        objectives: [{ id: objectiveId, title: "Recall", description: null, prerequisiteIds: [] }],
        noteLibrary: {
          types: [
            {
              id: "type",
              name: "Type",
              fields: [{ name: "Front" }],
              templates: [{ id: "forward", name: "Forward", front: "{{Front}}", back: "Answer" }],
            },
          ],
          notes: [
            {
              id: "note",
              typeId: "type",
              fields: { Front: "Question" },
              tags: [],
              objectiveIds: [objectiveId],
            },
          ],
        },
        cards: [
          {
            id: cardId,
            front: "Question",
            back: "Answer",
            objective: "Recall",
            objectiveIds: [objectiveId],
            schedule,
            importedSchedule: baseline,
          },
        ],
      },
    ],
    reviewEvents: [
      {
        id: eventId,
        areaId,
        cardId,
        ratedAt: now,
        rating: "good",
        schedulerFamily: "fsrs",
        schedulerVersion: "ts-fsrs@5.4.2",
      },
    ],
    pendingReviewEventIds: [eventId],
  };
}
await test("legacy sync identities remap limits, note objectives and every imported schedule reference", () => {
  const original = workspace();
  const unchanged = structuredClone(original);
  const normalized = prepareWorkspaceForSync(original, () => deviceId);
  const area = normalized.areas[0];
  const event = normalized.reviewEvents?.[0];
  const card = area?.cards[0];
  assert.ok(area && card && event);
  assert.notEqual(area.id, areaId);
  assert.deepEqual(normalized.schedulerSettings?.areaReviewLimits, { [area.id]: 7 });
  assert.equal(normalized.schedulerSettings.dailyLimitOverrides?.[0]?.areaId, area.id);
  assert.equal(normalized.syncStudyBaseline?.settings.dailyLimitOverrides?.[0]?.areaId, area.id);
  assert.equal(area.noteLibrary?.notes[0]?.objectiveIds[0], area.objectives?.[0]?.id);
  assert.notEqual(area.noteLibrary?.notes[0]?.objectiveIds[0], objectiveId);
  assert.deepEqual(card.importedSchedule?.reviewEventIds, [event.id]);
  const baseline = normalized.importedScheduleBaselines?.[0];
  assert.equal(baseline?.areaId, area.id);
  assert.equal(baseline.cardId, card.id);
  assert.deepEqual(baseline.baseline.reviewEventIds, [event.id]);
  assert.deepEqual(
    normalized.syncStudyBaseline.importedSchedules,
    normalized.importedScheduleBaselines,
  );
  assert.deepEqual(original, unchanged);
  assert.deepEqual(
    prepareWorkspaceForSync(normalized, () => deviceId),
    normalized,
  );
});
await test("event collision repair remaps imported event exclusions in active, retained and version snapshots", () => {
  const normalized = prepareWorkspaceForSync(workspace(), () => deviceId);
  const area = normalized.areas[0];
  const event = normalized.reviewEvents?.[0];
  const card = area?.cards[0];
  assert.ok(area && card && event);
  const replacement = "00000000-0000-4000-8000-000000000002";
  const input = {
    ...normalized,
    retainedReviewAreas: [area],
    cardVersions: [
      {
        id: "version",
        areaId: area.id,
        cardId: card.id,
        recordedAt: now,
        reason: "edit" as const,
        area: { ...area, cards: [] },
        card,
      },
    ],
  };
  const repaired = repairReviewSyncConflicts(
    input,
    [{ id: event.id, reason: "id-collision" }],
    () => replacement,
  );
  assert.deepEqual(repaired.areas[0]?.cards[0]?.importedSchedule?.reviewEventIds, [replacement]);
  assert.deepEqual(repaired.retainedReviewAreas?.[0]?.cards[0]?.importedSchedule?.reviewEventIds, [
    replacement,
  ]);
  assert.deepEqual(repaired.cardVersions?.[0]?.card.importedSchedule?.reviewEventIds, [
    replacement,
  ]);
  assert.deepEqual(repaired.importedScheduleBaselines?.[0]?.baseline.reviewEventIds, [replacement]);
  assert.deepEqual(repaired.syncStudyBaseline?.importedSchedules?.[0]?.baseline.reviewEventIds, [
    replacement,
  ]);
});

await test("imported exclusions with pruned legacy events normalize deterministically", () => {
  const original = workspace();
  const missing = createReviewEventId("pruned-imported-review");
  const input = {
    ...original,
    importedScheduleBaselines: original.importedScheduleBaselines?.map((item) => ({
      ...item,
      baseline: { ...item.baseline, reviewEventIds: [missing] },
    })),
  };
  const normalized = prepareWorkspaceForSync(input, () => deviceId);
  assert.deepEqual(normalized.importedScheduleBaselines?.[0]?.baseline.reviewEventIds, [
    stableSyncId(`review:${missing}`),
  ]);
});
