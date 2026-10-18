import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import {
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  type Assessment,
  type Workspace,
} from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import {
  applyWorkspaceAuthoringCommand,
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
  const studyCard: Assessment = {
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
        cards: [studyCard],
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

void test("restoration preview baseline fences intervening edits, deletes and area metadata, while reviews remain valid", () => {
  const original = edited();
  const command = restoreCommand(original);
  const baseline = workspaceAuthoringBaseline(original, command);
  for (const changed of [
    edited(original, "Another edit"),
    success(deleteStudyCard(original, { areaId, cardId }, later)),
    { ...original, areas: original.areas.map((area) => ({ ...area, title: "Renamed" })) },
  ]) {
    assert.equal(
      rejected(applyWorkspaceAuthoringCommand(changed, command, later, baseline)).reason,
      "stale-content",
    );
  }
  const latest = reviewed(original);
  const next = success(applyWorkspaceAuthoringCommand(latest, command, later, baseline)).workspace;
  assert.deepEqual(card(next).schedule, card(latest).schedule);
});

void test("recovery reinstates missing objectives and their transitive prerequisites without duplicating current ones", () => {
  const original = edited();
  const withoutObjective = {
    ...original,
    areas: original.areas.map((area) => ({
      ...area,
      objectives: area.objectives?.filter((objective) => objective.id === prerequisiteId),
    })),
  };
  const next = success(restoreCardVersion(withoutObjective, restoreCommand(original), later));
  assert.deepEqual(
    next.areas[0]?.objectives?.map((objective) => objective.id),
    [prerequisiteId, objectiveId],
  );
  assert.deepEqual(card(next).objectiveIds, [objectiveId]);
});

void test("restoration enforces card and objective capacity but permits replacing an existing card at capacity", () => {
  const original = edited();
  const cards = Array.from({ length: 500 }, (_, index) => ({
    ...card(original),
    id: createAssessmentId(`capacity-${String(index)}`),
  }));
  const full: Workspace = {
    ...original,
    areas: original.areas.map((area) => ({ ...area, cards })),
  };
  assert.match(rejected(restoreCardVersion(full, restoreCommand(original), later)).message, /500/);
  const activeFull = {
    ...full,
    areas: full.areas.map((area) => ({ ...area, cards: [card(original), ...area.cards.slice(1)] })),
  };
  assert.equal(
    success(restoreCardVersion(activeFull, restoreCommand(original), later)).areas[0]?.cards.length,
    500,
  );
  const objectiveFull = {
    ...original,
    areas: original.areas.map((area) => ({
      ...area,
      objectives: Array.from({ length: 200 }, (_, index) => ({
        id: createObjectiveId(`objective-${String(index)}`),
        title: "Other",
        description: null,
        prerequisiteIds: [],
      })),
    })),
  };
  assert.match(
    rejected(restoreCardVersion(objectiveFull, restoreCommand(original), later)).message,
    /limit/,
  );
});

void test("an identity moved into another area cannot be restored into its former area", () => {
  const original = edited();
  const area = original.areas[0];
  assert.ok(area);
  const moved = {
    ...original,
    areas: [
      { ...area, cards: [] },
      { ...area, id: createAreaId("other-area"), cards: [card(original)] },
    ],
  };
  assert.match(
    rejected(restoreCardVersion(moved, restoreCommand(original), later)).message,
    /another area/,
  );
});

void test("objective restoration expands a reverse-ordered prerequisite chain and preserves edited current objectives", () => {
  const original = fixture();
  const area = original.areas[0];
  assert.ok(area);
  const baseId = createObjectiveId("base-objective");
  const chain: Workspace = {
    ...original,
    areas: [
      {
        ...area,
        objectives: [
          {
            id: objectiveId,
            title: "Understand pointers",
            description: null,
            prerequisiteIds: [prerequisiteId],
          },
          { id: prerequisiteId, title: "Values", description: null, prerequisiteIds: [baseId] },
          { id: baseId, title: "Types", description: null, prerequisiteIds: [] },
        ],
      },
    ],
  };
  const archived = edited(chain);
  const current: Workspace = {
    ...archived,
    areas: [
      {
        ...area,
        cards: [card(archived)],
        objectives: [{ id: baseId, title: "Edited types", description: null, prerequisiteIds: [] }],
      },
    ],
  };
  const next = success(restoreCardVersion(current, restoreCommand(archived), later));
  assert.deepEqual(
    next.areas[0]?.objectives?.map((objective) => objective.id),
    [baseId, objectiveId, prerequisiteId],
  );
  assert.equal(next.areas[0].objectives[0]?.title, "Edited types");
});

void test("invalid edit and deletion times return expected failures without appending snapshots", () => {
  const original = fixture();
  const before = JSON.stringify(original);
  assert.equal(
    rejected(
      updateStudyCard(
        original,
        { areaId, cardId, content: content({ front: "Edited" }) },
        new Date(NaN),
      ),
    ).reason,
    "invalid-input",
  );
  assert.equal(
    rejected(deleteStudyCard(original, { areaId, cardId }, new Date(NaN))).reason,
    "invalid-input",
  );
  assert.equal(JSON.stringify(original), before);
});
