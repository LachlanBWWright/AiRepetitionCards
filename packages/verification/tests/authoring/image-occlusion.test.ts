import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import {
  createAssessmentId,
  ImageOcclusionSchema,
  MediaReferenceSchema,
  createReviewEventId,
  WorkspaceSchema,
  type ImageOcclusion,
  type Workspace,
} from "@recall/domain";
import {
  defaultOcclusionMask,
  occlusionQuestions,
  visibleOcclusionMasks,
  reconcileOcclusionCards,
  updateStudyCard,
  applyWorkspaceAuthoringCommand,
} from "@recall/application";
import { newSchedule } from "@recall/scheduler";
import { areaId } from "../fixtures/search-workspace";

const now = new Date("2026-10-20T00:00:00Z");
const image: ImageOcclusion = {
  imageMediaId: "a".repeat(64),
  mode: "hide-all",
  masks: [
    { ...defaultOcclusionMask("a", "rectangle"), label: "Liver" },
    defaultOcclusionMask("b", "ellipse"),
    { ...defaultOcclusionMask("c", "polygon"), groupId: "together" },
    { ...defaultOcclusionMask("d", "rectangle"), groupId: "together" },
  ],
  targetMaskIds: ["a"],
};
const id = createAssessmentId("image-card");
function fixture(): Workspace {
  return {
    schemaVersion: 1,
    reviews: 0,
    areas: [
      {
        id: areaId,
        title: "Anatomy",
        color: "#112233",
        cards: [
          {
            id,
            front: "Identify the region",
            back: "Answer",
            objective: "Anatomy",
            schedule: newSchedule(now),
            imageOcclusion: image,
            media: [
              Schema.decodeUnknownSync(MediaReferenceSchema)({
                id: image.imageMediaId,
                mimeType: "image/png",
                byteLength: 10,
              }),
            ],
          },
        ],
      },
    ],
  };
}
void test("occlusion validates bounded nondegenerate geometry and existing target references", () => {
  assert.ok(Either.isRight(Schema.decodeUnknownEither(ImageOcclusionSchema)(image)));
  for (const invalid of [
    { ...image, targetMaskIds: ["missing"] },
    { ...image, masks: [image.masks[0], image.masks[0]] },
    {
      ...image,
      masks: [
        {
          ...defaultOcclusionMask("a", "rectangle"),
          points: [
            { x: 0, y: 0 },
            { x: 2, y: 1 },
          ],
        },
      ],
    },
    {
      ...image,
      masks: [
        {
          ...defaultOcclusionMask("a", "polygon"),
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.5 },
            { x: 1, y: 1 },
          ],
        },
      ],
    },
  ])
    assert.ok(Either.isLeft(Schema.decodeUnknownEither(ImageOcclusionSchema)(invalid)));
});
void test("mask grouping and reveal respect hide-one and hide-all", () => {
  assert.deepEqual(occlusionQuestions(image), [["a"], ["b"], ["c", "d"]]);
  assert.equal(visibleOcclusionMasks(image, false).length, 4);
  assert.deepEqual(
    visibleOcclusionMasks(image, true).map((mask) => mask.id),
    ["b", "c", "d"],
  );
  assert.deepEqual(
    visibleOcclusionMasks({ ...image, mode: "hide-one" }, false).map((mask) => mask.id),
    ["a"],
  );
  assert.equal(visibleOcclusionMasks({ ...image, mode: "hide-one" }, true).length, 0);
});
void test("sibling regeneration preserves schedules and identities when masks move", () => {
  const initial = Effect.runSync(reconcileOcclusionCards(fixture(), areaId, id, now));
  assert.equal(initial.areas[0]?.cards.length, 3);
  const card = initial.areas[0].cards.find((entry) => entry.id === id);
  assert.ok(card?.imageOcclusion);
  const sourceImage = card.imageOcclusion;
  const edited = {
    ...initial,
    areas: initial.areas.map((area) => ({
      ...area,
      cards: area.cards.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              imageOcclusion: {
                ...sourceImage,
                masks: [...sourceImage.masks].reverse(),
              },
            }
          : entry,
      ),
    })),
  };
  const updated = Effect.runSync(reconcileOcclusionCards(edited, areaId, id, now, initial));
  assert.deepEqual(
    updated.areas[0]?.cards.map((entry) => entry.id).sort(),
    initial.areas[0].cards.map((entry) => entry.id).sort(),
  );
  for (const entry of updated.areas[0].cards)
    assert.deepEqual(
      entry.schedule,
      initial.areas[0].cards.find((old) => old.id === entry.id)?.schedule,
    );
  assert.ok(Either.isRight(Schema.decodeUnknownEither(WorkspaceSchema)(updated)));
});
void test("removed reviewed masks retain history, deletion tombstone, and review content", () => {
  const initial = Effect.runSync(reconcileOcclusionCards(fixture(), areaId, id, now));
  const root = initial.areas[0]?.cards.find((entry) => entry.id === id);
  assert.ok(root?.imageOcclusion);
  const removed = initial.areas[0]?.cards.find((entry) =>
    entry.imageOcclusion?.targetMaskIds.includes("b"),
  );
  assert.ok(removed);
  const reviewed: Workspace = {
    ...initial,
    reviewEvents: [
      {
        id: createReviewEventId("review-b"),
        areaId,
        cardId: removed.id,
        ratedAt: now.toISOString(),
        rating: "good",
        schedulerFamily: "fsrs",
        schedulerVersion: "test",
      },
    ],
  };
  const kept = {
    ...root.imageOcclusion,
    masks: root.imageOcclusion.masks.filter((mask) => mask.id !== "b"),
  };
  const edited = {
    ...reviewed,
    areas: reviewed.areas.map((area) => ({
      ...area,
      cards: area.cards.map((entry) =>
        entry.id === id ? { ...entry, imageOcclusion: kept } : entry,
      ),
    })),
  };
  const updated = Effect.runSync(reconcileOcclusionCards(edited, areaId, id, now, initial));
  assert.equal(updated.areas[0]?.cards.length, 2);
  assert.equal(updated.deletedCards?.length, 1);
  assert.equal(updated.reviewEvents?.length, 1);
  assert.equal(updated.retainedReviewAreas?.[0]?.cards[0]?.id, removed.id);
  assert.ok(Either.isRight(Schema.decodeUnknownEither(WorkspaceSchema)(updated)));
  assert.ok(updated.cardVersions?.some((version) => version.reason === "replace"));
});
void test("occlusion attachment must exist and be an image", () => {
  const workspace = fixture();
  const result = Effect.runSync(
    Effect.either(
      updateStudyCard(
        workspace,
        {
          areaId,
          cardId: id,
          content: {
            kind: "basic",
            front: "Question",
            back: "Answer",
            imageOcclusion: image,
            media: [],
            objectiveIds: [],
            tags: [],
          },
        },
        now,
      ),
    ),
  );
  assert.ok(Either.isLeft(result));
});

void test("create-card command generates exactly one card per question, without duplicating the source", () => {
  const original = fixture();
  const source = original.areas[0]?.cards[0];
  assert.ok(source);
  const empty: Workspace = {
    ...original,
    areas: original.areas.map((area) => ({ ...area, cards: [] })),
  };
  const result = Effect.runSync(
    applyWorkspaceAuthoringCommand(
      empty,
      {
        kind: "create-card",
        areaId,
        cardId: id,
        content: {
          kind: "basic",
          front: source.front,
          back: source.back,
          tags: [],
          objectiveIds: [],
          media: source.media,
          imageOcclusion: image,
        },
      },
      now,
    ),
  );
  assert.equal(result.workspace.areas[0]?.cards.length, 3);
  assert.equal(new Set(result.workspace.areas[0].cards.map((entry) => entry.id)).size, 3);
});
void test("removing occlusion converts the edited card and deletes generated siblings", () => {
  const initial = Effect.runSync(reconcileOcclusionCards(fixture(), areaId, id, now));
  const source = initial.areas[0]?.cards.find((entry) => entry.id === id);
  assert.ok(source);
  const result = Effect.runSync(
    applyWorkspaceAuthoringCommand(
      initial,
      {
        kind: "update-card",
        areaId,
        cardId: id,
        content: {
          kind: "basic",
          front: source.front,
          back: source.back,
          tags: [],
          objectiveIds: [],
          media: source.media,
          removeImageOcclusion: true,
        },
      },
      now,
    ),
  );
  assert.equal(result.workspace.areas[0]?.cards.length, 1);
  assert.equal(result.workspace.areas[0].cards[0]?.imageOcclusion, undefined);
  assert.equal(result.workspace.areas[0].cards[0]?.siblingId, undefined);
  assert.equal(result.workspace.deletedCards?.length, 2);
});

void test("removing the original target preserves surviving sibling identities and schedules", () => {
  const initial = Effect.runSync(reconcileOcclusionCards(fixture(), areaId, id, now));
  const source = initial.areas[0]?.cards.find((entry) => entry.id === id);
  assert.ok(source?.imageOcclusion);
  const changed = {
    ...source.imageOcclusion,
    masks: source.imageOcclusion.masks.filter((mask) => mask.id !== "a"),
    targetMaskIds: ["b"],
  };
  const result = Effect.runSync(
    applyWorkspaceAuthoringCommand(
      initial,
      {
        kind: "update-card",
        areaId,
        cardId: id,
        content: {
          kind: "basic",
          front: source.front,
          back: source.back,
          tags: [],
          objectiveIds: [],
          media: source.media,
          imageOcclusion: changed,
        },
      },
      now,
    ),
  );
  const survivors = initial.areas.flatMap((area) => area.cards.filter((entry) => entry.id !== id));
  assert.deepEqual(
    result.workspace.areas[0]?.cards.map((entry) => entry.id).sort(),
    survivors.map((entry) => entry.id).sort(),
  );
  for (const survivor of survivors)
    assert.deepEqual(
      result.workspace.areas[0].cards.find((entry) => entry.id === survivor.id)?.schedule,
      survivor.schedule,
    );
  assert.ok(result.workspace.deletedCards?.some((entry) => entry.cardId === id));
});

void test("creating from copied occlusion metadata creates an independent source group", () => {
  const initial = Effect.runSync(reconcileOcclusionCards(fixture(), areaId, id, now));
  const source = initial.areas[0]?.cards.find((entry) => entry.id === id);
  assert.ok(source?.imageOcclusion);
  const copyId = createAssessmentId("copied-image-card");
  const result = Effect.runSync(
    applyWorkspaceAuthoringCommand(
      initial,
      {
        kind: "create-card",
        areaId,
        cardId: copyId,
        content: {
          kind: "basic",
          front: "Copied question",
          back: "Copied answer",
          tags: [],
          objectiveIds: [],
          media: source.media,
          imageOcclusion: source.imageOcclusion,
        },
      },
      now,
    ),
  );
  const original = result.workspace.areas[0]?.cards.filter(
    (entry) => entry.imageOcclusion?.sourceId === id,
  );
  const copies = result.workspace.areas[0]?.cards.filter(
    (entry) => entry.imageOcclusion?.sourceId === copyId,
  );
  assert.equal(original?.length, 3);
  assert.equal(copies?.length, 3);
  assert.equal(
    new Set(result.workspace.areas.flatMap((area) => area.cards.map((entry) => entry.id))).size,
    6,
  );
});
