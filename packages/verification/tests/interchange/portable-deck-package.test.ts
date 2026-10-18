import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  createAreaId,
  createAssessmentId,
  createDeviceId,
  createReviewEventId,
  MediaReferenceSchema,
  createObjectiveId,
  type KnowledgeArea,
} from "@recall/domain";
import {
  exportPortableDeckPackage,
  importPortableDeckPackage,
  type PortableDeckPrivateHistoryInput,
} from "../../../application/src/interchange/portable/portable-deck-package";

const areaId = createAreaId("00000000-0000-4000-8000-000000000101");
const cardId = createAssessmentId("00000000-0000-4000-8000-000000000102");
const objectiveId = createObjectiveId("00000000-0000-4000-8000-000000000103");
const area: KnowledgeArea = {
  schemaVersion: "1.0.0",
  id: areaId,
  title: "Deck",
  description: null,
  language: "en",
  objectives: [{ id: objectiveId, title: "Concept", description: null, prerequisiteIds: [] }],
  ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
  cards: [
    {
      kind: "basic",
      id: cardId,
      front: "Q",
      back: "A",
      objectiveIds: [objectiveId],
      tags: [],
      origin: "authored",
    },
  ],
  tags: [],
  licence: null,
};
const mediaStore = {
  get: () => Effect.succeed(null),
  put: () => Effect.void,
  delete: () => Effect.void,
  list: Effect.succeed([]),
};
function success<A, E>(effect: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(effect));
  assert.ok(Either.isRight(result));
  return result.right;
}

void test("portable deck defaults to a public-safe package and round-trips authored content", () => {
  const archive = success(exportPortableDeckPackage(area, mediaStore));
  const entries = unzipSync(archive);
  assert.equal(entries["private-history.json"], undefined);
  const imported = success(importPortableDeckPackage(archive));
  assert.equal(imported.privacy, "public");
  assert.equal(imported.privateHistory, undefined);
  assert.deepEqual(imported.knowledgeArea, area);
});

void test("public serialization only includes canonical validated deck fields", () => {
  const sourceCard = area.cards[0];
  assert.ok(sourceCard);
  const withPrivateExtra = { ...area, privateAttemptAnswer: "never export this" } as unknown;
  const withNestedExtra = {
    ...(withPrivateExtra as KnowledgeArea),
    cards: [{ ...sourceCard, privateResponseDraft: "also private" }],
  } as unknown as KnowledgeArea;
  const archive = success(exportPortableDeckPackage(withNestedExtra, mediaStore));
  const contents = new TextDecoder().decode(unzipSync(archive)["knowledge-area.json"]);
  assert.equal(contents.includes("never export this"), false);
  assert.equal(contents.includes("privateAttemptAnswer"), false);
  assert.equal(contents.includes("also private"), false);
});

void test("private history is explicit, bounded to deck history, and retained in preview", () => {
  const input = {
    reviewEvents: [],
    cardVersions: [],
    activityLibrary: { version: 1 as const, activities: [], attempts: [] },
  };
  const currentArea = {
    id: areaId,
    title: "Deck",
    color: "#123456",
    cards: [
      {
        id: cardId,
        front: "Q",
        back: "A",
        objective: "Concept",
        objectiveIds: [objectiveId],
        tags: [],
        origin: "authored" as const,
        schedule: {
          due: "2026-10-15T00:00:00.000Z",
          stability: 5,
          difficulty: 4,
          elapsed_days: 2,
          scheduled_days: 3,
          learning_steps: 0,
          reps: 4,
          lapses: 1,
          state: 2 as const,
          last_review: "2026-10-12T00:00:00.000Z",
        },
      },
    ],
    objectives: [{ id: objectiveId, title: "Concept", description: null, prerequisiteIds: [] }],
  };
  const archive = success(exportPortableDeckPackage(area, mediaStore, { ...input, currentArea }));
  const files = unzipSync(archive);
  assert.ok(files["private-history.json"]);
  assert.equal(files["workspace.json"], undefined);
  const imported = success(importPortableDeckPackage(archive));
  assert.equal(imported.privacy, "private");
  assert.deepEqual(imported.privateHistory, {
    version: 1,
    currentArea,
    reviewEvents: [],
    cardVersions: [],
    activityLibrary: { version: 1, activities: [], attempts: [], drafts: [], editorDrafts: [] },
  });
});

void test("private history is canonicalized and strips account/device binding fields", () => {
  const currentArea = {
    id: areaId,
    title: "Deck",
    color: "#123456",
    cards: [
      {
        id: cardId,
        front: "Q",
        back: "A",
        objective: "Concept",
        objectiveIds: [objectiveId],
        tags: [],
        origin: "authored" as const,
        schedule: {
          due: "2026-10-15T00:00:00.000Z",
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          learning_steps: 0,
          reps: 0,
          lapses: 0,
          state: 0 as const,
        },
      },
    ],
    objectives: [{ id: objectiveId, title: "Concept", description: null, prerequisiteIds: [] }],
  };
  const review = {
    id: createReviewEventId("00000000-0000-4000-8000-000000000104"),
    areaId,
    cardId,
    ratedAt: "2026-10-15T00:00:00.000Z",
    rating: "good" as const,
    schedulerFamily: "fsrs" as const,
    schedulerVersion: "5",
    deviceId: createDeviceId("bound-device"),
    deviceSequence: 1,
    accountToken: "must-not-leak",
  };
  const history = {
    currentArea,
    reviewEvents: [review],
    cardVersions: [],
    activityLibrary: {
      version: 1 as const,
      activities: [],
      attempts: [],
      accountToken: "also-private",
    },
  } satisfies PortableDeckPrivateHistoryInput & {
    readonly activityLibrary: PortableDeckPrivateHistoryInput["activityLibrary"] & {
      readonly accountToken: string;
    };
  };
  const archive = success(exportPortableDeckPackage(area, mediaStore, history));
  const imported = success(importPortableDeckPackage(archive));
  const privateHistory = imported.privateHistory;
  assert.ok(privateHistory);
  const event = privateHistory.reviewEvents[0];
  assert.ok(event);
  assert.equal("deviceId" in event, false);
  assert.equal("deviceSequence" in event, false);
  assert.equal("accountToken" in event, false);
  assert.equal(
    "accountToken" in (privateHistory.activityLibrary as unknown as Record<string, unknown>),
    false,
  );
});

void test("private package carries media referenced only by an old card version", () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const digest = Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const reference = Schema.decodeUnknownSync(MediaReferenceSchema)({
    id: digest,
    mimeType: "image/png" as const,
    byteLength: bytes.byteLength,
  });
  const privateMediaStore: Parameters<typeof exportPortableDeckPackage>[1] = {
    ...mediaStore,
    get: (id) => Effect.succeed(id === reference.id ? { reference, bytes } : null),
  };
  const schedule = {
    due: "2026-10-15T00:00:00.000Z",
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    state: 0 as const,
  };
  const currentArea = {
    id: areaId,
    title: "Deck",
    color: "#123456",
    cards: [
      {
        id: cardId,
        front: "Q",
        back: "A",
        objective: "Concept",
        objectiveIds: [objectiveId],
        tags: [],
        origin: "authored" as const,
        schedule,
      },
    ],
    objectives: [{ id: objectiveId, title: "Concept", description: null, prerequisiteIds: [] }],
  };
  const cardVersion = {
    id: "version-1",
    areaId,
    cardId,
    recordedAt: "2026-10-14T00:00:00.000Z",
    reason: "edit" as const,
    card: {
      id: cardId,
      front: "Q",
      back: "Old answer",
      objective: "Concept",
      objectiveIds: [objectiveId],
      schedule,
      media: [reference],
    },
    area: { ...currentArea, cards: [] },
  };
  const archive = success(
    exportPortableDeckPackage(area, privateMediaStore, {
      currentArea,
      reviewEvents: [],
      cardVersions: [cardVersion],
      activityLibrary: { version: 1, activities: [], attempts: [] },
    }),
  );
  const imported = success(importPortableDeckPackage(archive));
  assert.equal(imported.media.length, 1);
  assert.deepEqual(imported.media[0]?.bytes, bytes);
});

void test("tampered entries and unexpected paths are rejected", () => {
  const archive = success(exportPortableDeckPackage(area, mediaStore));
  const files = unzipSync(archive);
  const broken = { ...files, "knowledge-area.json": strToU8("{}") };
  const result = Effect.runSync(Effect.either(importPortableDeckPackage(zipSync(broken))));
  assert.ok(Either.isLeft(result));
  const withTraversal = zipSync({ ...files, "../secret": strToU8("x") });
  const traversalResult = Effect.runSync(Effect.either(importPortableDeckPackage(withTraversal)));
  assert.ok(Either.isLeft(traversalResult));
});

void test("expanded ZIP content is rejected before archive extraction", () => {
  const oversized = zipSync({ "manifest.json": strToU8("x".repeat(40_000_001)) }, { level: 9 });
  const outcome = Effect.runSync(Effect.either(importPortableDeckPackage(oversized)));
  assert.ok(Either.isLeft(outcome));
  if (Either.isLeft(outcome)) assert.equal(outcome.left.reason, "limits-exceeded");
});
