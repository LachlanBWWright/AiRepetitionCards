import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { Effect, Either, Schema } from "effect";
import {
  WorkspaceSchema,
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  type Workspace,
  type Assessment,
} from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import {
  applyWorkspaceAuthoringCommand,
  captureCardVersion,
  cardVersionHistory,
  createStudyCard,
  deleteStudyCard,
  recordReview,
  restoreCardVersion,
  updateStudyCard,
  workspaceAuthoringBaseline,
  type CardContent,
  type WorkspaceAuthoringCommand,
} from "@recall/application";

const now = new Date("2026-10-04T00:00:00.000Z");
const later = new Date("2026-10-05T00:00:00.000Z");
const areaId = createAreaId("history-area");
const cardId = createAssessmentId("history-card");
const objectiveId = createObjectiveId("history-objective");
const prerequisiteId = createObjectiveId("history-prerequisite");

function success<A, E>(effect: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(effect));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}
function rejected<A, E>(effect: Effect.Effect<A, E>): E {
  const result = Effect.runSync(Effect.either(effect));
  assert.ok(Either.isLeft(result), JSON.stringify(result));
  return result.left;
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
          { id: prerequisiteId, title: "Values", description: null, prerequisiteIds: [] },
          {
            id: objectiveId,
            title: "Understand pointers",
            description: null,
            prerequisiteIds: [prerequisiteId],
          },
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
function edited(workspace = fixture(), text = "Edited question"): Workspace {
  return success(
    updateStudyCard(workspace, { areaId, cardId, content: content({ front: text }) }, now),
  );
}
function restoreCommand(
  workspace: Workspace,
): WorkspaceAuthoringCommand & { kind: "restore-card" } {
  const version = workspace.cardVersions?.[0];
  assert.ok(version);
  return { kind: "restore-card", areaId, cardId, versionId: version.id };
}
function reviewed(workspace: Workspace): Workspace {
  return success(
    recordReview({
      workspace,
      areaId,
      cardId,
      eventId: "00000000-0000-4000-8000-000000000991",
      rating: "good",
      ratedAt: later.toISOString(),
    }),
  ).workspace;
}

void test("creation and exact no-op edits create no phantom authored versions", () => {
  const original = fixture();
  const created = success(
    createStudyCard(original, { areaId, cardId: "fresh", content: content() }, now),
  );
  assert.equal(created.cardVersions, undefined);
  const unchanged = success(updateStudyCard(original, { areaId, cardId, content: content() }, now));
  assert.equal(unchanged.cardVersions, undefined);
  assert.deepEqual(card(unchanged), { ...card(original), cloze: undefined });
});

void test("content and metadata edits append exact prior snapshots without changing schedules", () => {
  for (const change of [
    { front: "Changed" },
    { back: "Changed" },
    { tags: ["pointer"] },
    { objectiveIds: [prerequisiteId] },
  ]) {
    const original = fixture();
    const before = JSON.stringify(original);
    const next = success(
      updateStudyCard(original, { areaId, cardId, content: content(change) }, later),
    );
    assert.equal(next.cardVersions?.length, 1);
    const version = next.cardVersions[0];
    assert.ok(version);
    assert.equal(version.reason, "edit");
    assert.equal(version.recordedAt, later.toISOString());
    assert.deepEqual(version.card, card(original));
    assert.deepEqual(version.area.cards, []);
    assert.deepEqual(card(next).schedule, card(original).schedule);
    assert.equal(JSON.stringify(original), before);
    assert.ok(Either.isRight(Schema.decodeUnknownEither(WorkspaceSchema)(next)));
  }
});

void test("arbitrary edit sequences retain every previous version in append order and history queries do not mutate", () => {
  fc.assert(
    fc.property(
      fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 25 }),
      (texts) => {
        let workspace = fixture();
        const fronts = [card(workspace).front];
        for (const [index, text] of texts.entries()) {
          workspace = edited(workspace, `${String(index)}:${text}`);
          fronts.push(card(workspace).front);
        }
        assert.deepEqual(
          workspace.cardVersions?.map((version) => version.card.front),
          fronts.slice(0, -1),
        );
        const before = JSON.stringify(workspace);
        assert.deepEqual(
          cardVersionHistory(workspace, areaId, cardId).map((version) => version.card.front),
          fronts.slice(0, -1).reverse(),
        );
        assert.deepEqual(cardVersionHistory(workspace, "other"), []);
        assert.deepEqual(cardVersionHistory(workspace, undefined, "other"), []);
        assert.equal(JSON.stringify(workspace), before);
      },
    ),
    { numRuns: 60, seed: 991 },
  );
});

void test("active restoration keeps latest reviewed schedule and append-only review events and is undoable", () => {
  const original = edited();
  const latest = reviewed(original);
  const before = JSON.stringify(latest);
  const restored = success(restoreCardVersion(latest, restoreCommand(latest), later));
  assert.equal(card(restored).front, "Original question");
  assert.deepEqual(card(restored).schedule, card(latest).schedule);
  assert.deepEqual(restored.reviewEvents, latest.reviewEvents);
  assert.equal(restored.reviews, latest.reviews);
  assert.equal(restored.cardVersions?.at(-1)?.reason, "restore");
  assert.equal(restored.cardVersions.at(-1)?.card.front, "Edited question");
  const undoVersion = restored.cardVersions.at(-1);
  assert.ok(undoVersion);
  const undo = success(
    restoreCardVersion(restored, { areaId, cardId, versionId: undoVersion.id }, later),
  );
  assert.equal(card(undo).front, "Edited question");
  assert.deepEqual(undo.reviewEvents, latest.reviewEvents);
  assert.equal(JSON.stringify(latest), before);
});

void test("delete is idempotent and local recovery reuses identity, schedule and clears retained tombstones", () => {
  const original = reviewed(edited());
  const deleted = success(deleteStudyCard(original, { areaId, cardId }, later));
  assert.equal(deleted.cardVersions?.at(-1)?.reason, "delete");
  assert.deepEqual(success(deleteStudyCard(deleted, { areaId, cardId }, later)), deleted);
  assert.equal(deleted.retainedReviewAreas?.[0]?.cards[0]?.id, cardId);
  const restored = success(restoreCardVersion(deleted, restoreCommand(deleted), later));
  assert.equal(card(restored).id, cardId);
  assert.deepEqual(card(restored).schedule, card(original).schedule);
  assert.deepEqual(restored.deletedCards, []);
  assert.deepEqual(restored.retainedReviewAreas, []);
  assert.deepEqual(restored.reviewEvents, original.reviewEvents);
});

void test("area deletion records each card and local recovery restores only requested content and objectives", () => {
  const original = success(
    createStudyCard(fixture(), { areaId, cardId: "second", content: content() }, now),
  );
  const deleted = success(
    applyWorkspaceAuthoringCommand(original, { kind: "delete-area", areaId }, later),
  ).workspace;
  assert.equal(deleted.areas.length, 0);
  assert.equal(deleted.cardVersions?.length, 2);
  const restored = success(restoreCardVersion(deleted, restoreCommand(deleted), later));
  assert.equal(restored.areas.length, 1);
  assert.equal(restored.areas[0]?.cards.length, 1);
  assert.equal(card(restored).id, cardId);
  assert.deepEqual(restored.deletedAreas, []);
});

void test("atomic replacement captures original once, keeps reviews and creates fresh schedules", () => {
  const original = reviewed(fixture());
  const command: WorkspaceAuthoringCommand = {
    kind: "replace-card",
    areaId,
    cardId,
    cards: [
      { cardId: createAssessmentId("replacement-a"), content: content({ front: "A" }) },
      { cardId: createAssessmentId("replacement-b"), content: content({ front: "B" }) },
    ],
  };
  const next = success(applyWorkspaceAuthoringCommand(original, command, later)).workspace;
  assert.equal(next.cardVersions?.length, 1);
  assert.equal(next.cardVersions[0]?.reason, "replace");
  assert.equal(next.areas[0]?.cards.length, 2);
  for (const replacement of next.areas[0].cards)
    assert.deepEqual(replacement.schedule, newSchedule(later));
  assert.deepEqual(next.reviewEvents, original.reviewEvents);
  const before = JSON.stringify(original);
  rejected(
    applyWorkspaceAuthoringCommand(
      original,
      {
        ...command,
        cards: [
          ...command.cards,
          { cardId: createAssessmentId("replacement-a"), content: content() },
        ],
      },
      later,
    ),
  );
  assert.equal(JSON.stringify(original), before);
});

void test("restoration rejects invalid boundaries, unavailable/mismatched version IDs and invalid time without mutation", () => {
  const original = edited();
  const before = JSON.stringify(original);
  for (const input of [
    null,
    {},
    { ...restoreCommand(original), versionId: "" },
    { ...restoreCommand(original), versionId: "missing" },
    { ...restoreCommand(original), cardId: "other" },
    { ...restoreCommand(original), areaId: "other" },
  ]) {
    assert.equal(rejected(restoreCardVersion(original, input, later))._tag, "CardHistoryFailure");
  }
  assert.equal(
    rejected(restoreCardVersion({}, restoreCommand(original), later))._tag,
    "CardHistoryFailure",
  );
  assert.match(
    rejected(restoreCardVersion(original, restoreCommand(original), new Date(NaN))).message,
    /time/,
  );
  assert.equal(JSON.stringify(original), before);
});

void test("version schema rejects identity mismatch, embedded area cards, bad timestamp and invalid reason", () => {
  const original = edited();
  const version = original.cardVersions?.[0];
  assert.ok(version);
  for (const change of [
    { cardId: "other" },
    { areaId: "other" },
    { recordedAt: "not-a-date" },
    { reason: "review" },
    { area: fixture().areas[0] },
    { id: "" },
  ]) {
    const invalid: unknown = { ...original, cardVersions: [{ ...version, ...change }] };
    assert.ok(Either.isLeft(Schema.decodeUnknownEither(WorkspaceSchema)(invalid)));
    assert.equal(
      rejected(restoreCardVersion(invalid, restoreCommand(original), later))._tag,
      "CardHistoryFailure",
    );
  }
});

void test("edit and deletion preview baselines reject changed content/objectives but accept new reviews", () => {
  const original = fixture();
  const commands: readonly WorkspaceAuthoringCommand[] = [
    { kind: "update-card", areaId, cardId, content: content({ front: "Proposed" }) },
    { kind: "delete-card", areaId, cardId },
  ];
  for (const command of commands) {
    const baseline = workspaceAuthoringBaseline(original, command);
    assert.equal(
      rejected(applyWorkspaceAuthoringCommand(edited(), command, later, baseline)).reason,
      "stale-content",
    );
    const objectiveChanged = {
      ...original,
      areas: original.areas.map((area) => ({
        ...area,
        objectives: area.objectives?.map((objective) => ({ ...objective, title: "Updated" })),
      })),
    };
    assert.equal(
      rejected(applyWorkspaceAuthoringCommand(objectiveChanged, command, later, baseline)).reason,
      "stale-content",
    );
    success(applyWorkspaceAuthoringCommand(reviewed(original), command, later, baseline));
  }
});

void test("restoration preview fences account binding and changed recovery mode but permits irrelevant offline metadata", () => {
  const deleted = success(deleteStudyCard(edited(), { areaId, cardId }, later));
  const command = restoreCommand(deleted);
  const baseline = workspaceAuthoringBaseline(deleted, command);
  for (const metadata of [
    { syncOwnerId: "00000000-0000-4000-8000-000000000993" },
    { syncCursor: "1" },
  ]) {
    const connected = success(Schema.decodeUnknown(WorkspaceSchema)({ ...deleted, ...metadata }));
    assert.equal(
      rejected(applyWorkspaceAuthoringCommand(connected, command, later, baseline)).reason,
      "stale-content",
    );
  }
  success(
    applyWorkspaceAuthoringCommand({ ...deleted, syncCursor: "0" }, command, later, baseline),
  );
  const active = edited();
  const activeCommand = restoreCommand(active);
  const activeBaseline = workspaceAuthoringBaseline(active, activeCommand);
  const bound = success(
    Schema.decodeUnknown(WorkspaceSchema)({
      ...active,
      syncOwnerId: "00000000-0000-4000-8000-000000000993",
    }),
  );
  assert.equal(
    rejected(applyWorkspaceAuthoringCommand(bound, activeCommand, later, activeBaseline)).reason,
    "stale-content",
  );
});

void test("snapshot readers filter area and identity separately and accept empty legacy history", () => {
  assert.deepEqual(cardVersionHistory(fixture()), []);
  const original = edited();
  const area = original.areas[0];
  assert.ok(area);
  const secondCard = { ...card(original), id: createAssessmentId("second-card") };
  const otherArea = { ...area, id: createAreaId("other-area"), cards: [secondCard] };
  const captured = captureCardVersion(original, otherArea, secondCard, "delete", later);
  assert.equal(cardVersionHistory(captured).length, 2);
  assert.equal(cardVersionHistory(captured, areaId).length, 1);
  assert.equal(cardVersionHistory(captured, undefined, "second-card")[0]?.areaId, "other-area");
});

void test("restoration of local unreviewed deletions recovers archived schedule without retained review content", () => {
  const original = edited();
  const deleted = success(deleteStudyCard(original, { areaId, cardId }, later));
  assert.deepEqual(deleted.retainedReviewAreas ?? [], []);
  const next = success(restoreCardVersion(deleted, restoreCommand(deleted), later));
  assert.deepEqual(card(next).schedule, card(original).schedule);
  assert.equal(next.reviews, 0);
});
