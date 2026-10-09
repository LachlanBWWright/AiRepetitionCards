import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { Effect, Either } from "effect";
import {
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  type Workspace,
} from "@recall/domain";
import { cardIdForTutorProposal } from "@recall/ai-core";
import { newSchedule } from "@recall/scheduler";
import {
  applyWorkspaceAuthoringCommand,
  workspaceAuthoringBaseline,
  updateStudyCard,
  createStudyCard,
  deleteStudyCard,
  recordReview,
  updateSchedulerSettings,
  toKnowledgeArea,
  prepareTutorCardApproval,
  type WorkspaceAuthoringCommand,
} from "@recall/application";

const now = new Date("2026-10-03T00:00:00.000Z");
const areaId = createAreaId("00000000-0000-4000-8000-000000000101");
const cardId = createAssessmentId("00000000-0000-4000-8000-000000000102");
const objectiveId = createObjectiveId("00000000-0000-4000-8000-000000000103");
const sessionId = "00000000-0000-4000-8000-000000000104";
const proposalId = "00000000-0000-4000-8000-000000000105";
const proposal = {
  front: "New question",
  back: "New answer",
  objectiveId,
  rationale: "Learner-approved correction",
};
const content = {
  kind: "basic" as const,
  front: "Edited question",
  back: "Edited answer",
  objectiveIds: [objectiveId],
  tags: ["edited"],
  media: [],
};
function workspace(): Workspace {
  return {
    schemaVersion: 1,
    reviews: 0,
    reviewEvents: [],
    areas: [
      {
        id: areaId,
        title: "Learning",
        color: "#112233",
        objectives: [
          { id: objectiveId, title: "Understand", description: null, prerequisiteIds: [] },
        ],
        cards: [
          {
            id: cardId,
            front: "Q",
            back: "A",
            objective: "Understand",
            objectiveIds: [objectiveId],
            origin: "imported",
            sourceId: "original-card",
            schedule: newSchedule(now),
          },
        ],
      },
    ],
  };
}
function success<A, E>(operation: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isRight(result));
  return result.right;
}
function reviewed(input = workspace()): Workspace {
  return success(
    recordReview({
      workspace: input,
      areaId,
      cardId,
      eventId: "00000000-0000-4000-8000-000000000106",
      rating: "good",
      ratedAt: now.toISOString(),
    }),
  ).workspace;
}

void test("authoring changes retain schedules, origin, lineage and append-only reviews", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 80 }), (text) => {
      const original = reviewed();
      const snapshot = JSON.stringify(original);
      const next = success(
        updateStudyCard(original, {
          areaId,
          cardId,
          content: { ...content, front: `Question ${text}` },
        }),
      );
      assert.deepEqual(next.reviewEvents, original.reviewEvents);
      assert.deepEqual(next.areas[0]?.cards[0]?.schedule, original.areas[0]?.cards[0]?.schedule);
      assert.equal(next.areas[0]?.cards[0]?.sourceId, "original-card");
      assert.equal(next.areas[0].cards[0].origin, "imported");
      assert.equal(JSON.stringify(original), snapshot);
    }),
    { numRuns: 40, seed: 401 },
  );
});

void test("content baselines allow concurrent reviews and reject competing content edits", () => {
  const initial = workspace();
  const command: WorkspaceAuthoringCommand = { kind: "update-card", areaId, cardId, content };
  const baseline = workspaceAuthoringBaseline(initial, command);
  const latest = reviewed(initial);
  const accepted = success(applyWorkspaceAuthoringCommand(latest, command, now, baseline));
  assert.deepEqual(accepted.workspace.reviewEvents, latest.reviewEvents);
  assert.deepEqual(
    accepted.workspace.areas[0]?.cards[0]?.schedule,
    latest.areas[0]?.cards[0]?.schedule,
  );
  const changed = success(
    updateStudyCard(initial, { areaId, cardId, content: { ...content, front: "Other edit" } }),
  );
  const stale = Effect.runSync(
    Effect.either(applyWorkspaceAuthoringCommand(changed, command, now, baseline)),
  );
  assert.ok(Either.isLeft(stale));
  assert.equal(stale.left.reason, "stale-content");
});

void test("invalid Basic/Cloze authoring rejects drafts without replacing the workspace", () => {
  const initial = workspace();
  const snapshot = JSON.stringify(initial);
  for (const invalid of [
    { ...content, front: "   " },
    { ...content, kind: "cloze", cloze: { text: "No deletion", deletionIndex: 1 } },
  ]) {
    assert.ok(
      Either.isLeft(
        Effect.runSync(
          Effect.either(
            createStudyCard(initial, { areaId, cardId: "new-card", content: invalid }, now),
          ),
        ),
      ),
    );
  }
  assert.equal(JSON.stringify(initial), snapshot);
});

void test("card deletion preserves pending review evidence privately", () => {
  const initial = reviewed();
  const deleted = success(deleteStudyCard(initial, { areaId, cardId }));
  assert.equal(deleted.areas[0]?.cards.length, 0);
  assert.deepEqual(deleted.reviewEvents, initial.reviewEvents);
  assert.equal(deleted.retainedReviewAreas?.[0]?.cards[0]?.id, cardId);
});

void test("target retention is private and does not rewrite schedules or history", () => {
  const initial = reviewed();
  fc.assert(
    fc.property(fc.integer({ min: 70, max: 97 }), (percent) => {
      const next = success(updateSchedulerSettings(initial, { requestRetention: percent / 100 }));
      assert.deepEqual(next.areas, initial.areas);
      assert.deepEqual(next.reviewEvents, initial.reviewEvents);
      const area = next.areas[0];
      assert.ok(area);
      assert.equal("schedulerSettings" in success(toKnowledgeArea(area)), false);
    }),
    { numRuns: 30, seed: 402 },
  );
});

void test("approved proposal identity is deterministic and retries preserve edited durable cards", () => {
  const initial = reviewed();
  const command = { areaId, sessionId, proposalId, proposal };
  const first = success(prepareTutorCardApproval(initial, command, now));
  assert.equal(first.cardId, cardIdForTutorProposal(proposalId));
  assert.deepEqual(initial.areas[0]?.cards.length, 1);
  const retry = success(
    prepareTutorCardApproval(first.workspace, command, new Date(now.getTime() + 86400000)),
  );
  assert.deepEqual(retry.workspace, first.workspace);
  const edited = success(
    updateStudyCard(first.workspace, {
      areaId,
      cardId: first.cardId,
      content: { ...content, front: "Durably edited approved card" },
    }),
  );
  const secondRetry = success(
    prepareTutorCardApproval(
      edited,
      { ...command, proposal: { ...proposal, front: "A different draft" } },
      now,
    ),
  );
  assert.equal(secondRetry.proposal.front, "Durably edited approved card");
  assert.deepEqual(secondRetry.workspace, edited);
  assert.deepEqual(secondRetry.workspace.reviewEvents, initial.reviewEvents);
});

void test("approval validates proposals, objectives and stable identity collisions", () => {
  const initial = workspace();
  for (const invalid of [
    { ...proposal, front: "" },
    { ...proposal, objectiveId: "missing-objective" },
  ]) {
    assert.ok(
      Either.isLeft(
        Effect.runSync(
          Effect.either(
            prepareTutorCardApproval(
              initial,
              { areaId, sessionId, proposalId, proposal: invalid },
              now,
            ),
          ),
        ),
      ),
    );
  }
  const derivedId = cardIdForTutorProposal(proposalId);
  assert.ok(derivedId);
  const collision = success(createStudyCard(initial, { areaId, cardId: derivedId, content }, now));
  const rejected = Effect.runSync(
    Effect.either(
      prepareTutorCardApproval(collision, { areaId, sessionId, proposalId, proposal }, now),
    ),
  );
  assert.ok(Either.isLeft(rejected));
  assert.match(rejected.left.message, /existing card identity/);
  assert.equal(initial.areas[0]?.cards.length, 1);
});

void test("proposal-derived approval IDs are stable across fresh workspaces", () => {
  fc.assert(
    fc.property(fc.integer({ min: 200, max: 999999 }), (suffix) => {
      const candidateId = `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
      const command = { areaId, sessionId, proposalId: candidateId, proposal };
      const first = success(prepareTutorCardApproval(workspace(), command, now));
      const independent = success(prepareTutorCardApproval(workspace(), command, now));
      assert.equal(first.cardId, independent.cardId);
      assert.equal(first.cardId, cardIdForTutorProposal(candidateId));
      assert.equal(first.workspace.areas[0]?.cards.length, 2);
      assert.equal(first.workspace.areas[0].cards[1]?.origin, "ai-generated");
      assert.equal(first.workspace.areas[0].cards[1].sourceId, `tutor:${sessionId}:${candidateId}`);
    }),
    { numRuns: 30, seed: 403 },
  );
});
