import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Either, Schema } from "effect";
import {
  createAreaId,
  createAssessmentId,
  createReviewEventId,
  type Workspace,
} from "@recall/domain";
import { newSchedule, scheduleReview } from "@recall/scheduler";
import {
  applyWorkspaceAuthoringCommand,
  workspaceAuthoringBaseline,
  LibraryNotesSchema,
  emptyLibraryNotes,
  retainLibraryDraft,
  discardLibraryDraft,
  toggleCardFlag,
  type WorkspaceAuthoringCommand,
  type LibraryDraft,
} from "@recall/application";

const now = new Date("2026-10-13T09:00:00Z");
const sourceId = createAreaId("source-deck");
const targetId = createAreaId("destination-deck");
const firstId = createAssessmentId("first-card");
const secondId = createAssessmentId("second-card");
const reviewId = createReviewEventId("original-review");
const workspace: Workspace = {
  schemaVersion: 1,
  reviews: 1,
  reviewEvents: [
    {
      id: reviewId,
      areaId: sourceId,
      cardId: firstId,
      ratedAt: now.toISOString(),
      rating: "good",
      schedulerFamily: "fsrs",
      schedulerVersion: "ts-fsrs@5.4.2",
    },
  ],
  pendingReviewEventIds: [reviewId],
  areas: [
    {
      id: sourceId,
      title: "Biology",
      color: "#3b82f6",
      cards: [firstId, secondId].map((id) => ({
        id,
        front: `Question ${id}`,
        back: "Answer",
        objective: "Cells",
        tags: ["existing"],
        schedule: newSchedule(now),
      })),
    },
    { id: targetId, title: "Exam", color: "#3b82f6", cards: [] },
  ],
};
const apply = (input: Workspace, command: unknown, baseline?: string) =>
  Effect.runSync(Effect.either(applyWorkspaceAuthoringCommand(input, command, now, baseline)));

await test("bulk tagging preserves schedules, immutable inputs, reviews and recoverable content versions", () => {
  const original = structuredClone(workspace);
  const result = apply(workspace, {
    kind: "bulk-tag-cards",
    areaId: sourceId,
    cardIds: [firstId, secondId],
    tags: ["exam", "existing"],
  });
  assert.equal(Either.isRight(result), true);
  if (Either.isLeft(result)) return;
  assert.deepEqual(
    result.right.workspace.areas[0]?.cards.map((card) => card.tags),
    [
      ["existing", "exam"],
      ["existing", "exam"],
    ],
  );
  assert.deepEqual(result.right.workspace.reviewEvents, workspace.reviewEvents);
  assert.deepEqual(
    result.right.workspace.areas[0].cards.map((card) => card.schedule),
    workspace.areas[0]?.cards.map((card) => card.schedule),
  );
  assert.equal(result.right.workspace.cardVersions?.length, 2);
  assert.deepEqual(workspace, original);
});

await test("stale selections fail atomically while concurrent reviews do not invalidate authoring", () => {
  const command: WorkspaceAuthoringCommand = {
    kind: "bulk-tag-cards",
    areaId: sourceId,
    cardIds: [firstId, secondId],
    tags: ["exam"],
  };
  const baseline = workspaceAuthoringBaseline(workspace, command);
  const edited = {
    ...workspace,
    areas: workspace.areas.map((area) =>
      area.id === sourceId
        ? {
            ...area,
            cards: area.cards.map((card) =>
              card.id === secondId ? { ...card, front: "Changed by another view" } : card,
            ),
          }
        : area,
    ),
  };
  const rejected = apply(edited, command, baseline);
  assert.equal(Either.isLeft(rejected), true);
  if (Either.isLeft(rejected)) assert.equal(rejected.left.reason, "stale-content");
  const reviewed = {
    ...workspace,
    areas: workspace.areas.map((area) => ({
      ...area,
      cards: area.cards.map((card) => ({
        ...card,
        schedule: scheduleReview(card.schedule, "good", now),
      })),
    })),
  };
  assert.equal(Either.isRight(apply(reviewed, command, baseline)), true);
});

await test("bulk deletion preserves original review identities and retains pending review content", () => {
  const result = apply(workspace, {
    kind: "bulk-delete-cards",
    areaId: sourceId,
    cardIds: [firstId, secondId],
  });
  assert.equal(Either.isRight(result), true);
  if (Either.isLeft(result)) return;
  assert.equal(result.right.workspace.areas[0]?.cards.length, 0);
  assert.deepEqual(result.right.workspace.reviewEvents, workspace.reviewEvents);
  assert.deepEqual(result.right.workspace.pendingReviewEventIds, workspace.pendingReviewEventIds);
  assert.equal(result.right.workspace.deletedCards?.length, 2);
  assert.equal(result.right.workspace.cardVersions?.length, 2);
  assert.equal(result.right.workspace.retainedReviewAreas?.[0]?.cards[0]?.id, firstId);
});

await test("moves retain original history and copy content into fresh independent schedules", () => {
  const result = apply(workspace, {
    kind: "bulk-move-cards",
    areaId: sourceId,
    targetAreaId: targetId,
    cards: [
      { cardId: firstId, newCardId: "moved-first" },
      { cardId: secondId, newCardId: "moved-second" },
    ],
  });
  assert.equal(Either.isRight(result), true);
  if (Either.isLeft(result)) return;
  assert.equal(result.right.workspace.areas[0]?.cards.length, 0);
  assert.equal(result.right.workspace.areas[1]?.cards.length, 2);
  assert.equal(result.right.workspace.areas[1].cards[0]?.id, "moved-first");
  assert.deepEqual(result.right.workspace.areas[1].cards[0].tags, ["existing"]);
  assert.deepEqual(result.right.workspace.areas[1].cards[0].schedule, newSchedule(now));
  assert.deepEqual(result.right.workspace.reviewEvents, workspace.reviewEvents);
  assert.equal(result.right.workspace.retainedReviewAreas?.[0]?.cards[0]?.id, firstId);
});

await test("invalid selections, identifier collisions and tag limits never partially apply a batch", () => {
  const original = structuredClone(workspace);
  for (const command of [
    { kind: "bulk-delete-cards", areaId: sourceId, cardIds: [firstId, "missing"] },
    { kind: "bulk-delete-cards", areaId: sourceId, cardIds: [firstId, firstId] },
    {
      kind: "bulk-tag-cards",
      areaId: sourceId,
      cardIds: [firstId, secondId],
      tags: ["x".repeat(81)],
    },
    {
      kind: "bulk-move-cards",
      areaId: sourceId,
      targetAreaId: targetId,
      cards: [{ cardId: firstId, newCardId: secondId }],
    },
    {
      kind: "bulk-move-cards",
      areaId: sourceId,
      targetAreaId: sourceId,
      cards: [{ cardId: firstId, newCardId: "new" }],
    },
  ])
    assert.equal(Either.isLeft(apply(workspace, command)), true);
  assert.deepEqual(workspace, original);
});

await test("incomplete drafts stay proposals, flags deduplicate, and clearing one draft leaves other work intact", () => {
  const draft: LibraryDraft = {
    kind: "card",
    key: "new-card:source",
    areaId: sourceId,
    id: "draft-card",
    mode: "create",
    cardKind: "cloze",
    front: "",
    back: "",
    clozeText: "unfinished {{c1",
    clozeIndex: "",
    tagsText: "",
    objectiveIds: [],
    media: [],
    removedMediaIds: [],
  };
  const notes = retainLibraryDraft(emptyLibraryNotes, draft);
  const decoded = Schema.decodeUnknownEither(Schema.parseJson(LibraryNotesSchema))(
    JSON.stringify(notes),
  );
  assert.equal(Either.isRight(decoded), true);
  assert.equal(retainLibraryDraft(notes, { ...draft, front: "Latest draft" }).drafts.length, 1);
  const flagged = toggleCardFlag(notes, firstId);
  assert.deepEqual(flagged.flaggedCardIds, [firstId]);
  assert.deepEqual(toggleCardFlag(flagged, firstId).flaggedCardIds, []);
  assert.deepEqual(discardLibraryDraft(flagged, draft.key).flaggedCardIds, [firstId]);
  assert.equal(
    Either.isLeft(
      Schema.decodeUnknownEither(LibraryNotesSchema)({
        version: 1,
        drafts: [{ kind: "card" }],
        flaggedCardIds: [],
      }),
    ),
    true,
  );
  assert.deepEqual(emptyLibraryNotes, { version: 1, drafts: [], flaggedCardIds: [] });
});
