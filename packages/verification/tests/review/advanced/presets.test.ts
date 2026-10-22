import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { createAreaId, createAssessmentId, parseWorkspaceJson } from "@recall/domain";
import {
  resolveStudySettings,
  updateSchedulerSettings,
  studyQueue,
  recordReview,
  rebuildWorkspaceSchedules,
} from "@recall/application";
import { schedulerParametersFromId } from "@recall/scheduler";
import { workspace, card, areaId, now, day, review } from "./fixtures";

await test("subjects inherit parent presets and respect parent plus global introduction budgets", () => {
  const initial = workspace([card("a"), card("c"), card("d")]);
  const parentId = createAreaId("parent");
  const childId = createAreaId("child");
  const area = initial.areas[0];
  assert.ok(area);
  const configured = {
    ...initial,
    areas: [area, { ...area, id: parentId, cards: [] }, { ...area, id: childId, cards: [] }],
    schedulerSettings: {
      requestRetention: 0.9,
      dailyNewLimit: 20,
      presets: [
        {
          id: "biology",
          name: "Biology",
          settings: { requestRetention: 0.95, dailyNewLimit: 2, learningSteps: [2, 15] },
        },
      ],
      areaPresets: { [parentId]: "biology" },
      areaParents: { [areaId]: parentId, [childId]: parentId },
    },
    reviewEvents: [{ ...review(1, now, "other"), areaId: childId }],
  };
  const saved = Effect.runSync(updateSchedulerSettings(configured, configured.schedulerSettings));
  assert.equal(resolveStudySettings(saved, areaId).requestRetention, 0.95);
  assert.deepEqual(resolveStudySettings(saved, areaId).learningSteps, [2, 15]);
  assert.equal(studyQueue(saved, area, now, day).cards.length, 1);
  assert.deepEqual(Effect.runSync(parseWorkspaceJson(JSON.stringify(saved))), saved);
});

await test("preset edits affect future reviews while historical events replay their original policy", () => {
  const initial = workspace([card("a")]);
  const settings = {
    requestRetention: 0.9,
    presets: [
      {
        id: "p",
        name: "Preset",
        settings: { requestRetention: 0.97, learningSteps: [3, 20], maximumInterval: 100 },
      },
    ],
    areaPresets: { [areaId]: "p" },
  };
  const configured = Effect.runSync(updateSchedulerSettings(initial, settings));
  const result = Effect.runSync(
    recordReview({
      workspace: configured,
      areaId,
      cardId: createAssessmentId("a"),
      eventId: "preset-review",
      ratedAt: new Date(now).toISOString(),
      rating: "again",
    }),
  );
  const parameters = Effect.runSync(
    schedulerParametersFromId(result.event.schedulerParameterSetId),
  );
  assert.deepEqual(parameters.learningSteps, [3, 20]);
  assert.equal(parameters.requestRetention, 0.97);
  const changed = Effect.runSync(
    updateSchedulerSettings(result.workspace, { requestRetention: 0.7 }),
  );
  assert.deepEqual(
    Effect.runSync(rebuildWorkspaceSchedules(changed)).areas,
    result.workspace.areas,
  );
});

await test("preset validation rejects cycles, missing presets, invalid zones and unordered learning steps", () => {
  const initial = workspace();
  for (const settings of [
    { requestRetention: 0.9, areaParents: { a: "b", b: "a" } },
    { requestRetention: 0.9, areaPresets: { [areaId]: "missing" } },
    { requestRetention: 0.9, timeZone: "unknown/zone" },
    { requestRetention: 0.9, learningSteps: [10, 1] },
  ])
    assert.ok(
      Either.isLeft(Effect.runSync(Effect.either(updateSchedulerSettings(initial, settings)))),
    );
});
