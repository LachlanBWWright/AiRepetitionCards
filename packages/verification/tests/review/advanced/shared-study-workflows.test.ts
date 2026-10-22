import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { createAreaId, createAssessmentId } from "@recall/domain";
import {
  summarizeStudySubjects,
  nextStudyArea,
  schedulerSettingsDraft,
  createStudyPreset,
  assignStudyGroup,
  removeStudyPreset,
  saveStudySearch,
  removeStudySearch,
  prepareManualSchedulingCommand,
  reviewElapsedMs,
} from "@recall/application";
import { workspace, card, areaId, now } from "./fixtures";

await test("review-all skips subjects containing only suspended or filtered cards and retains full content", () => {
  const initial = workspace([card("blocked")]);
  const first = initial.areas[0];
  assert.ok(first);
  const other = { ...first, id: createAreaId("other"), title: "Other", cards: [card("eligible")] };
  const current = {
    ...initial,
    areas: [first, other],
    schedulerSettings: { requestRetention: 0.9, suspendedCardIds: [createAssessmentId("blocked")] },
  };
  assert.equal(nextStudyArea(current, now)?.id, other.id);
  const rows = summarizeStudySubjects(current, now);
  assert.equal(rows.find((row) => row.area.id === areaId)?.due, 0);
  assert.deepEqual(rows.find((row) => row.area.id === areaId)?.area.cards, first.cards);
  assert.equal(
    nextStudyArea(
      {
        ...current,
        schedulerSettings: { ...current.schedulerSettings, activeStudyQuery: "front:missing" },
      },
      now,
    ),
    undefined,
  );
  assert.equal(
    nextStudyArea(
      { ...current, schedulerSettings: { requestRetention: 0.9, dailyNewLimit: 0 } },
      now,
    ),
    undefined,
  );
});

await test("presets copy current draft values on every client and cannot be removed while assigned", () => {
  const settings = schedulerSettingsDraft(
    { requestRetention: 0.9 },
    { retentionPercent: "95", dailyNewLimit: "7", leechThreshold: "3" },
  );
  const created = Effect.runSync(createStudyPreset(settings, "Exam"));
  assert.equal(created.settings.presets[0]?.settings.requestRetention, 0.95);
  assert.equal(created.settings.presets[0].settings.dailyNewLimit, 7);
  assert.equal(created.settings.presets[0].settings.leechThreshold, 3);
  const assigned = assignStudyGroup(created.settings, areaId, "areaPresets", created.id);
  assert.ok(Either.isLeft(Effect.runSync(Effect.either(removeStudyPreset(assigned, created.id)))));
  const removed = Effect.runSync(
    removeStudyPreset(assignStudyGroup(assigned, areaId, "areaPresets", undefined), created.id),
  );
  assert.equal(removed.presets?.length, 0);
  assert.ok(
    Either.isLeft(Effect.runSync(Effect.either(createStudyPreset(created.settings, " exam ")))),
  );
});

await test("settings preserve untouched precision and reject blank numeric drafts at validation boundaries", () => {
  const original = { requestRetention: 0.90123456789 };
  assert.equal(
    schedulerSettingsDraft(original, { retentionPercent: String(original.requestRetention * 100) })
      .requestRetention,
    original.requestRetention,
  );
  assert.equal(
    schedulerSettingsDraft(original, {
      retentionPercent: String(Number((original.requestRetention * 100).toPrecision(12))),
    }).requestRetention,
    original.requestRetention,
  );
  assert.ok(Number.isNaN(schedulerSettingsDraft(original, { dailyNewLimit: "" }).dailyNewLimit));
  assert.ok(
    Either.isLeft(
      Effect.runSync(
        Effect.either(
          createStudyPreset(
            schedulerSettingsDraft(original, { dailyNewLimit: "" }),
            "Invalid draft",
          ),
        ),
      ),
    ),
  );
});

await test("saved-search creation validates queries and IDs consistently without changing its input", () => {
  const initial = { requestRetention: 0.9 };
  const saved = Effect.runSync(saveStudySearch(initial, "New", "is:new"));
  const second = Effect.runSync(saveStudySearch(saved, "Review", "is:review"));
  assert.notEqual(second.savedSearches.at(0)?.id, second.savedSearches.at(1)?.id);
  assert.ok(
    Either.isLeft(Effect.runSync(Effect.either(saveStudySearch(saved, "Duplicate", "is:new")))),
  );
  assert.ok(
    Either.isLeft(Effect.runSync(Effect.either(saveStudySearch(saved, "Invalid", "is:missing")))),
  );
  assert.equal(removeStudySearch(second, "is:new").savedSearches?.length, 1);
  assert.deepEqual(initial, { requestRetention: 0.9 });
});

await test("manual command preparation rejects invalid positions, oversized batches and ambiguous due dates", () => {
  const draft = {
    kind: "administer-cards",
    areaId,
    cardIds: ["a"],
    operationId: "manual",
    action: "due",
    due: "2026-10-20T09:00:00+11:00",
  };
  const due = Effect.runSync(prepareManualSchedulingCommand(draft));
  assert.equal(due.due, "2026-10-19T22:00:00.000Z");
  for (const change of [
    { action: "reposition", position: "" },
    { action: "reposition", position: "-1" },
    { cardIds: Array.from({ length: 501 }, (_, index) => String(index)) },
    { due: "2026-10-20T09:00:00" },
  ]) {
    assert.ok(
      Either.isLeft(
        Effect.runSync(Effect.either(prepareManualSchedulingCommand({ ...draft, ...change }))),
      ),
    );
  }
});

await test("review duration is bounded consistently through clock rollback and long idle periods", () => {
  assert.equal(reviewElapsedMs(now, now - 1000), 0);
  assert.equal(reviewElapsedMs(now, now + 1234.4), 1234);
  assert.equal(reviewElapsedMs(now, now + 300_000), 60_000);
});
