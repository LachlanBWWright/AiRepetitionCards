import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { createAreaId, type Workspace } from "@recall/domain";
import {
  applyWorkspaceAuthoringCommand,
  createStudyCard,
  recordReview,
  workspaceAuthoringBaseline,
  type CardContent,
  type WorkspaceAuthoringCommand,
} from "@recall/application";

const now = new Date("2026-10-20T00:00:00Z");
const areaId = createAreaId("ordinary-cloze-area");
const initial: Workspace = {
  schemaVersion: 1,
  reviews: 0,
  reviewEvents: [],
  areas: [{ id: areaId, title: "Cloze", color: "#123456", cards: [] }],
};
function success<A, E>(effect: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(effect));
  assert.ok(Either.isRight(result), JSON.stringify(result));
  return result.right;
}
function content(text: string, deletionIndex = 1): CardContent {
  return {
    kind: "cloze",
    front: "ignored",
    back: "ignored",
    cloze: { text, deletionIndex },
    tags: [],
    media: [],
    objectiveIds: [],
  };
}
function apply(workspace: Workspace, command: unknown): Workspace {
  return success(applyWorkspaceAuthoringCommand(workspace, command, now)).workspace;
}

void test("ordinary create-card generates all nested cloze siblings with a shared source", () => {
  const workspace = apply(initial, {
    kind: "create-card",
    areaId,
    cardId: "selected",
    content: content("{{c1::outer {{c2::inner}}}}"),
  });
  const area = workspace.areas[0];
  assert.equal(area?.cards.length, 2);
  assert.equal(area.cards.find((card) => card.cloze?.deletionIndex === 1)?.id, "selected");
  assert.equal(area.noteLibrary?.notes.length, 1);
  assert.equal(new Set(area.cards.map((card) => card.noteId)).size, 1);
});
void test("ordinary create-cards retains supplied sibling identities and reuses compatible note types", () => {
  const text = "{{c1::one}} {{c2::two}}";
  const first = apply(initial, {
    kind: "create-cards",
    areaId,
    cards: [
      { cardId: "one", content: content(text) },
      { cardId: "two", content: content(text, 2) },
    ],
  });
  assert.deepEqual(new Set(first.areas[0]?.cards.map((card) => card.id)), new Set(["one", "two"]));
  const second = apply(first, {
    kind: "create-card",
    areaId,
    cardId: "other",
    content: content("{{c1::other source}}"),
  });
  assert.equal(second.areas[0]?.noteLibrary?.notes.length, 2);
  assert.equal(second.areas[0].noteLibrary.types.length, 1);
});
void test("first edit adopts legacy siblings and preserves review evidence and surviving schedules", () => {
  const text = "{{c1::one}} {{c2::two}}";
  const legacyOne = success(
    createStudyCard(initial, { areaId, cardId: "legacy-one", content: content(text) }, now),
  );
  const legacy = success(
    createStudyCard(legacyOne, { areaId, cardId: "legacy-two", content: content(text, 2) }, now),
  );
  const reviewed = success(
    recordReview({
      workspace: legacy,
      areaId,
      cardId: "legacy-two",
      rating: "good",
      eventId: "legacy-review",
      ratedAt: now.toISOString(),
    }),
  ).workspace;
  const oldSchedule = reviewed.areas[0]?.cards.find((card) => card.id === "legacy-two")?.schedule;
  const edited = apply(reviewed, {
    kind: "update-card",
    areaId,
    cardId: "legacy-one",
    content: content("{{c2::changed}} {{c3::added}}"),
  });
  const area = edited.areas[0];
  assert.deepEqual(edited.reviewEvents, reviewed.reviewEvents);
  assert.deepEqual(area?.cards.find((card) => card.id === "legacy-two")?.schedule, oldSchedule);
  assert.equal(area?.cards.find((card) => card.id === "legacy-two")?.back, "changed added");
  assert.equal(area.cards.length, 2);
  assert.ok(edited.deletedCards?.some((card) => card.cardId === "legacy-one"));
  assert.ok(edited.cardVersions?.some((card) => card.cardId === "legacy-one"));
  assert.equal(area.noteLibrary?.notes[0]?.fields.Text, "{{c2::changed}} {{c3::added}}");
});
void test("ordinary edits update linked cloze sources and never reuse retired deletion identities", () => {
  const created = apply(initial, {
    kind: "create-card",
    areaId,
    cardId: "one",
    content: content("{{c1::one}} {{c2::two}}"),
  });
  const retiredId = created.areas[0]?.cards.find((card) => card.cloze?.deletionIndex === 2)?.id;
  const removed = apply(created, {
    kind: "update-card",
    areaId,
    cardId: "one",
    content: content("{{c1::one}}"),
  });
  const restored = apply(removed, {
    kind: "update-card",
    areaId,
    cardId: "one",
    content: content("{{c1::one}} {{c2::two}}"),
  });
  assert.notEqual(
    restored.areas[0]?.cards.find((card) => card.cloze?.deletionIndex === 2)?.id,
    retiredId,
  );
});
void test("duplicate legacy deletion identities fail without silently dropping a card", () => {
  const text = "{{c1::same}}";
  const first = success(
    createStudyCard(initial, { areaId, cardId: "first", content: content(text) }, now),
  );
  const duplicated = success(
    createStudyCard(first, { areaId, cardId: "second", content: content(text) }, now),
  );
  const result = Effect.runSync(
    Effect.either(
      applyWorkspaceAuthoringCommand(
        duplicated,
        { kind: "update-card", areaId, cardId: "first", content: content(text) },
        now,
      ),
    ),
  );
  assert.ok(Either.isLeft(result));
  assert.equal(duplicated.areas[0]?.cards.length, 2);
});
void test("cloze edit baselines include sibling content and allow concurrent schedule changes", () => {
  const created = apply(initial, {
    kind: "create-card",
    areaId,
    cardId: "one",
    content: content("{{c1::one}} {{c2::two}}"),
  });
  const card = created.areas[0]?.cards[0];
  assert.ok(card);
  const command: WorkspaceAuthoringCommand = {
    kind: "update-card",
    areaId,
    cardId: card.id,
    content: content("{{c1::changed}} {{c2::two}}"),
  };
  const baseline = workspaceAuthoringBaseline(created, command);
  const reviewed = success(
    recordReview({
      workspace: created,
      areaId,
      cardId: card.id,
      rating: "good",
      eventId: "review",
      ratedAt: now.toISOString(),
    }),
  ).workspace;
  assert.equal(workspaceAuthoringBaseline(reviewed, command), baseline);
  const competing = apply(created, { ...command, content: content("{{c1::other}} {{c2::two}}") });
  const stale = Effect.runSync(
    Effect.either(applyWorkspaceAuthoringCommand(competing, command, now, baseline)),
  );
  assert.ok(Either.isLeft(stale));
  assert.equal(stale.left.reason, "stale-content");
});

void test("bulk cloze replacement changes a selected shared source once even when replacement contains find text", () => {
  const created = apply(initial, {
    kind: "create-card",
    areaId,
    cardId: "one",
    content: content("{{c1::a}} {{c2::a}}"),
  });
  const originalArea = created.areas[0];
  assert.ok(originalArea);
  const replaced = apply(created, {
    kind: "replace-card-fields",
    areaId,
    cardIds: originalArea.cards.map((card) => card.id),
    field: "cloze",
    find: "a",
    replacement: "aa",
  });
  const area = replaced.areas[0];
  assert.ok(area);
  assert.deepEqual(
    area.cards.map((card) => card.cloze?.text),
    ["{{c1::aa}} {{c2::aa}}", "{{c1::aa}} {{c2::aa}}"],
  );
  assert.deepEqual(
    area.cards.map((card) => card.id),
    originalArea.cards.map((card) => card.id),
  );
  assert.deepEqual(
    area.cards.map((card) => card.schedule),
    originalArea.cards.map((card) => card.schedule),
  );
  assert.equal(replaced.cardVersions?.length, (created.cardVersions?.length ?? 0) + 2);
});

void test("bulk cloze source replacement can remove a selected sibling and add an index while preserving review history", () => {
  const created = apply(initial, {
    kind: "create-card",
    areaId,
    cardId: "one",
    content: content("{{c1::one}} {{c2::two}}"),
  });
  const originalArea = created.areas[0];
  assert.ok(originalArea);
  const survivor = originalArea.cards.find((card) => card.cloze?.deletionIndex === 2);
  assert.ok(survivor);
  const reviewed = success(
    recordReview({
      workspace: created,
      areaId,
      cardId: survivor.id,
      rating: "good",
      eventId: "bulk-review",
      ratedAt: now.toISOString(),
    }),
  ).workspace;
  const reviewedArea = reviewed.areas[0];
  assert.ok(reviewedArea);
  const replaced = apply(reviewed, {
    kind: "replace-card-fields",
    areaId,
    cardIds: originalArea.cards.map((card) => card.id),
    field: "cloze",
    find: "{{c1::one}}",
    replacement: "{{c3::three}}",
  });
  const area = replaced.areas[0];
  assert.ok(area);
  assert.equal(area.cards.length, 2);
  assert.deepEqual(
    area.cards.find((card) => card.id === survivor.id)?.schedule,
    reviewedArea.cards.find((card) => card.id === survivor.id)?.schedule,
  );
  assert.ok(area.cards.some((card) => card.cloze?.deletionIndex === 3));
  assert.ok(replaced.deletedCards?.some((card) => card.cardId === "one"));
  assert.ok(replaced.cardVersions?.some((card) => card.cardId === "one"));
  assert.deepEqual(replaced.reviewEvents, reviewed.reviewEvents);
});
