import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import {
  WorkspaceSchema,
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  type Assessment,
  type Workspace,
} from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import { stableSyncId } from "@recall/sync-core";
import {
  applyWorkspaceAuthoringCommand,
  captureCardVersion,
  cardVersionRestoresAsCopy,
  createStudyCard,
  deleteStudyCard,
  restoreCardVersion,
  updateStudyCard,
  type CardContent,
  type WorkspaceAuthoringCommand,
} from "@recall/application";

const now = new Date("2026-10-04T00:00:00.000Z");
const later = new Date("2026-10-05T00:00:00.000Z");
const areaId = createAreaId("history-area");
const cardId = createAssessmentId("history-card");
const objectiveId = createObjectiveId("history-objective");

function success<A, E>(effect: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(effect));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}

function fixture(): Workspace {
  const card: Assessment = {
    id: cardId,
    front: "Original question",
    back: "Original answer",
    objective: "Understand pointers",
    objectiveIds: [objectiveId],
    tags: [],
    media: [],
    origin: "authored",
    schedule: newSchedule(now),
  };
  return {
    schemaVersion: 1,
    reviews: 0,
    reviewEvents: [],
    areas: [
      {
        id: areaId,
        title: "Go",
        color: "#112233",
        objectives: [
          { id: objectiveId, title: "Understand pointers", description: null, prerequisiteIds: [] },
        ],
        cards: [card],
      },
    ],
  };
}

function card(workspace: Workspace): Assessment {
  const result = workspace.areas
    .find((area) => area.id === areaId)
    ?.cards.find((item) => item.id === cardId);
  assert.ok(result);
  return result;
}

function content(overrides: Partial<CardContent> = {}): CardContent {
  return {
    kind: "basic",
    front: "Original question",
    back: "Original answer",
    objectiveIds: [objectiveId],
    tags: [],
    media: [],
    ...overrides,
  };
}

function edited(workspace = fixture()): Workspace {
  return success(
    updateStudyCard(
      workspace,
      { areaId, cardId, content: content({ front: "Edited question" }) },
      now,
    ),
  );
}

function restoreCommand(
  workspace: Workspace,
): WorkspaceAuthoringCommand & { kind: "restore-card" } {
  const version = workspace.cardVersions?.[0];
  assert.ok(version);
  return { kind: "restore-card", areaId, cardId, versionId: version.id };
}

void test("connected and legacy sync deletion recovery uses fresh identities and preserves permanent tombstones", () => {
  for (const metadata of [
    { syncOwnerId: "00000000-0000-4000-8000-000000000992" },
    { syncCursor: "3" },
    { syncContentHashes: { [areaId]: "a".repeat(64) } },
  ]) {
    const deleted = success(deleteStudyCard(edited(), { areaId, cardId }, later));
    const connected = success(Schema.decodeUnknown(WorkspaceSchema)({ ...deleted, ...metadata }));
    assert.ok(cardVersionRestoresAsCopy(connected, areaId, cardId));
    const next = success(restoreCardVersion(connected, restoreCommand(connected), later));
    const copy = next.areas[0]?.cards[0];
    assert.ok(copy);
    assert.notEqual(copy.id, cardId);
    assert.deepEqual(copy.schedule, newSchedule(later));
    assert.deepEqual(next.deletedCards, connected.deletedCards);
    assert.deepEqual(next.retainedReviewAreas, connected.retainedReviewAreas);
    assert.deepEqual(next.reviewEvents, connected.reviewEvents);
    assert.equal(copy.front, "Original question");
  }
});

void test("active connected restore keeps identity rather than making a copy", () => {
  const workspace = success(
    Schema.decodeUnknown(WorkspaceSchema)({ ...edited(), syncCursor: "9" }),
  );
  assert.equal(cardVersionRestoresAsCopy(workspace, areaId, cardId), false);
  const next = success(restoreCardVersion(workspace, restoreCommand(workspace), later));
  assert.equal(card(next).id, cardId);
});

void test("connected deleted-area recovery creates a fresh area and reuses it on subsequent recovery", () => {
  const original = success(
    createStudyCard(fixture(), { areaId, cardId: "second", content: content() }, now),
  );
  const deleted = success(
    applyWorkspaceAuthoringCommand(original, { kind: "delete-area", areaId }, later),
  ).workspace;
  const connected = success(Schema.decodeUnknown(WorkspaceSchema)({ ...deleted, syncCursor: "2" }));
  const first = success(restoreCardVersion(connected, restoreCommand(connected), later));
  assert.notEqual(first.areas[0]?.id, areaId);
  assert.equal(first.areas.length, 1);
  const secondVersion = connected.cardVersions?.[1];
  assert.ok(secondVersion);
  const second = success(
    restoreCardVersion(
      first,
      { areaId, cardId: secondVersion.cardId, versionId: secondVersion.id },
      later,
    ),
  );
  assert.equal(second.areas.length, 1);
  assert.equal(second.areas[0]?.cards.length, 2);
  assert.deepEqual(second.deletedAreas, connected.deletedAreas);
});

void test("version identifier collision skips used sequence IDs and repeated copy recovery uses unique IDs", () => {
  const original = edited();
  const version = original.cardVersions?.[0];
  assert.ok(version);
  const collision = { ...original, cardVersions: [{ ...version, id: `version:${cardId}:2` }] };
  const area = collision.areas[0];
  assert.ok(area);
  const captured = captureCardVersion(collision, area, card(collision), "edit", later);
  assert.equal(captured.cardVersions?.[1]?.id, `version:${cardId}:3`);
  const deleted = success(deleteStudyCard(original, { areaId, cardId }, later));
  const connected = success(Schema.decodeUnknown(WorkspaceSchema)({ ...deleted, syncCursor: "1" }));
  const command = restoreCommand(connected);
  const firstCandidate = createAssessmentId(stableSyncId(`restore:${command.versionId}:3`));
  const occupied = success(
    createStudyCard(connected, { areaId, cardId: firstCandidate, content: content() }, now),
  );
  const first = success(restoreCardVersion(occupied, command, later));
  const second = success(restoreCardVersion(first, command, later));
  const ids = second.areas.flatMap((item) => item.cards.map((studyCard) => studyCard.id));
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
});
