import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either } from "effect";
import { createAssessmentId, parseWorkspaceJson } from "@recall/domain";
import {
  administerCards,
  rebuildWorkspaceSchedules,
  recordReview,
  studyQueue,
} from "@recall/application";
import { newSchedule } from "@recall/scheduler";
import { workspace, card, areaId, now, day } from "./fixtures";

await test("due-date adjustments are append-only, idempotent and survive replay and backup", () => {
  const initial = workspace([card("a")]);
  const command = {
    kind: "administer-cards",
    operationId: "due-change",
    areaId,
    cardIds: ["a"],
    action: "due",
    due: "2026-11-01T12:00:00Z",
  };
  const updated = Effect.runSync(administerCards(initial, command, new Date(now)));
  assert.equal(updated.areas[0]?.cards[0]?.schedule.due, "2026-11-01T12:00:00.000Z");
  assert.equal(updated.scheduleAdjustments?.length, 1);
  assert.deepEqual(updated.reviewEvents, initial.reviewEvents);
  assert.deepEqual(
    Effect.runSync(administerCards(updated, command, new Date(now + 1000))),
    updated,
  );
  assert.deepEqual(Effect.runSync(rebuildWorkspaceSchedules(updated)), updated);
  assert.deepEqual(Effect.runSync(parseWorkspaceJson(JSON.stringify(updated))), updated);
  assert.ok(
    Either.isLeft(
      Effect.runSync(
        Effect.either(
          administerCards(updated, { ...command, due: "2026-12-01T12:00:00Z" }, new Date(now)),
        ),
      ),
    ),
  );
});

await test("reset plus subsequent reviews replay from new memory without deleting older answers", () => {
  const initial = workspace([card("a")]);
  const first = Effect.runSync(
    recordReview({
      workspace: initial,
      areaId,
      cardId: "a",
      eventId: "before-reset",
      rating: "easy",
      ratedAt: new Date(now - 86_400_000).toISOString(),
    }),
  );
  const reset = Effect.runSync(
    administerCards(
      first.workspace,
      { kind: "administer-cards", operationId: "reset", areaId, cardIds: ["a"], action: "reset" },
      new Date(now),
    ),
  );
  assert.deepEqual(reset.areas[0]?.cards[0]?.schedule, newSchedule(new Date(now)));
  const due = Effect.runSync(
    administerCards(
      reset,
      {
        kind: "administer-cards",
        operationId: "after-reset-due",
        areaId,
        cardIds: ["a"],
        action: "due",
        due: "2026-10-18T13:00:00Z",
      },
      new Date(now),
    ),
  );
  assert.deepEqual(Effect.runSync(rebuildWorkspaceSchedules(due)), due);
  const second = Effect.runSync(
    recordReview({
      workspace: reset,
      areaId,
      cardId: "a",
      eventId: "after-reset",
      rating: "good",
      ratedAt: new Date(now + 60_000).toISOString(),
    }),
  );
  assert.equal(second.workspace.reviewEvents?.length, 2);
  assert.equal(second.workspace.areas[0]?.cards[0]?.schedule.reps, 1);
  assert.deepEqual(Effect.runSync(rebuildWorkspaceSchedules(second.workspace)), second.workspace);
  // The reset marker in the answer transports enough information to replay on another device.
  assert.deepEqual(
    Effect.runSync(rebuildWorkspaceSchedules({ ...second.workspace, scheduleAdjustments: [] }))
      .areas,
    second.workspace.areas,
  );
  const area = second.workspace.areas[0];
  assert.ok(area);
  assert.equal(studyQueue(second.workspace, area, now + 60_000, day).introducedToday, 1);
});

await test("new-card repositioning is deterministic and rejects learned cards", () => {
  const initial = workspace([card("a"), card("b"), card("learned", true)]);
  const updated = Effect.runSync(
    administerCards(
      initial,
      {
        kind: "administer-cards",
        operationId: "position",
        areaId,
        cardIds: ["b", "a"],
        action: "reposition",
        position: 0,
      },
      new Date(now),
    ),
  );
  const area = updated.areas[0];
  assert.ok(area);
  assert.deepEqual(
    studyQueue(updated, area, now, day)
      .cards.filter((item) => item.schedule.state === 0)
      .map((item) => item.id),
    ["b", "a"],
  );
  assert.ok(
    Either.isLeft(
      Effect.runSync(
        Effect.either(
          administerCards(
            updated,
            {
              kind: "administer-cards",
              operationId: "bad",
              areaId,
              cardIds: [createAssessmentId("learned")],
              action: "reposition",
              position: 0,
            },
            new Date(now),
          ),
        ),
      ),
    ),
  );
});
