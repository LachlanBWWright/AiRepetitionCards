import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import type { Workspace } from "@recall/domain";
import {
  rebuildWorkspaceSchedules,
  recordReview,
  undoReview,
  syncWorkspace,
  applyDeckWorkspaceUpdate,
  toKnowledgeArea,
} from "@recall/application";
import { newSchedule, scheduleReview } from "@recall/scheduler";
import {
  workspace,
  review,
  areaId,
  cardId,
  time,
  uuid,
  server,
} from "../workspace/workspace-sync-fixtures";

function importedWorkspace(): Workspace {
  const history = review(10, cardId, "2026-09-03T12:00:00.000Z");
  const baseline = {
    schedule: {
      ...scheduleReview(newSchedule(new Date(history.ratedAt)), "easy", new Date(history.ratedAt)),
      due: time,
    },
    reviewEventIds: [history.id],
  };
  const original = workspace([history]);
  return {
    ...original,
    areas: original.areas.map((area) => ({
      ...area,
      cards: area.cards.map((card) => ({
        ...card,
        schedule: baseline.schedule,
        importedSchedule: baseline,
      })),
    })),
  };
}
const currentSchedule = (input: Workspace) => input.areas[0]?.cards[0]?.schedule;
const replay = (input: Workspace) => Effect.runSync(rebuildWorkspaceSchedules(input));

void test("imported historical answers never apply twice and replay remains idempotent", () => {
  const initial = importedWorkspace();
  const rebuilt = replay(initial);
  assert.deepEqual(currentSchedule(rebuilt), currentSchedule(initial));
  assert.deepEqual(currentSchedule(replay(rebuilt)), currentSchedule(initial));
  assert.equal(rebuilt.reviewEvents?.length, 1);
});
void test("new answers seed from imported schedules and undo restores that imported baseline", () => {
  const initial = importedWorkspace();
  const rated = Effect.runSync(
    recordReview({
      workspace: initial,
      areaId,
      cardId,
      eventId: uuid(11),
      ratedAt: time,
      rating: "good",
    }),
  ).workspace;
  assert.equal(currentSchedule(rated)?.reps, (currentSchedule(initial)?.reps ?? 0) + 1);
  assert.deepEqual(currentSchedule(replay(rated)), currentSchedule(rated));
  const restored = Effect.runSync(
    undoReview(
      rated,
      { kind: "undo-review", eventId: uuid(11), operationId: "undo-imported-answer" },
      new Date(time),
    ),
  );
  assert.deepEqual(currentSchedule(restored), currentSchedule(initial));
  assert.equal(restored.reviewEvents?.length, 2);
  assert.deepEqual(currentSchedule(replay(restored)), currentSchedule(initial));
});
void test("private baseline rehydrates content from another device before replay", () => {
  const remote = server();
  const sync = (input: Workspace) => {
    const result = Effect.runSync(syncWorkspace(remote.input(input)));
    assert.ok(result._tag === "Synced");
    return result.workspace;
  };
  const initial = importedWorkspace();
  const sent = sync(initial);
  const other = sync(workspace([]));
  assert.deepEqual(currentSchedule(other), currentSchedule(initial));
  assert.deepEqual(
    other.areas[0]?.cards[0]?.importedSchedule,
    initial.areas[0]?.cards[0]?.importedSchedule,
  );
  assert.equal(other.importedScheduleBaselines?.length, 1);
  assert.deepEqual(currentSchedule(replay(other)), currentSchedule(initial));
  const rated = Effect.runSync(
    recordReview({
      workspace: other,
      areaId,
      cardId,
      eventId: uuid(12),
      ratedAt: time,
      rating: "hard",
    }),
  ).workspace;
  sync(rated);
  const returned = sync(sent);
  assert.deepEqual(currentSchedule(returned), currentSchedule(rated));
});

void test("offline public deck updates preserve private imported schedules before the first sync", () => {
  const initial = importedWorkspace();
  const fork: Workspace = {
    ...initial,
    areas: initial.areas.map((area) => ({
      ...area,
      sourceId: uuid(90),
      forkedFromVersionId: uuid(92),
      cards: area.cards.map((card) => ({ ...card, sourceId: uuid(91) })),
    })),
  };
  const area = fork.areas[0];
  assert.ok(area);
  const portable = Effect.runSync(toKnowledgeArea(area, true, true));
  const upstream = {
    ...portable,
    cards: portable.cards.map((card) => ({ ...card, front: "Updated public question" })),
  };
  const updated = Effect.runSync(
    applyDeckWorkspaceUpdate(
      { workspace: fork, updatedArea: upstream, newVersionId: uuid(93), advanceBaseline: true },
      new Date(time),
      () => uuid(94),
    ),
  );
  assert.equal(updated.importedScheduleBaselines, undefined);
  assert.equal(updated.areas[0]?.cards[0]?.front, "Updated public question");
  assert.deepEqual(updated.areas[0].cards[0].importedSchedule, area.cards[0]?.importedSchedule);
  assert.deepEqual(currentSchedule(replay(updated)), currentSchedule(fork));
  assert.equal(updated.reviewEvents?.length, 1);
});
