import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { Effect, Either } from "effect";
import {
  createAreaId,
  createAssessmentId,
  createObjectiveId,
  decodeAndMigrateKnowledgeArea,
  parseKnowledgeAreaJson,
  type KnowledgeArea,
} from "@recall/domain";
import { fromKnowledgeArea, toKnowledgeArea, renderCloze } from "@recall/application";

const now = new Date("2026-10-03T00:00:00.000Z");
const areaId = createAreaId("00000000-0000-4000-8000-000000000001");
const cardId = createAssessmentId("00000000-0000-4000-8000-000000000002");
const objectiveId = createObjectiveId("00000000-0000-4000-8000-000000000003");
function document(front = "Question", back = "Answer"): KnowledgeArea {
  return {
    schemaVersion: "1.0.0",
    id: areaId,
    title: "Learning",
    description: null,
    language: "en",
    objectives: [{ id: objectiveId, title: "Understand", description: null, prerequisiteIds: [] }],
    ai: {
      tutorInstructions: "Ask one question.",
      quizInstructions: null,
      cardGenerationInstructions: null,
    },
    cards: [
      {
        kind: "basic",
        id: cardId,
        front,
        back,
        objectiveIds: [objectiveId],
        tags: ["learning"],
        origin: "imported",
      },
    ],
    tags: [],
    licence: "CC0",
    attribution: "Original author",
  };
}
function success<A, E>(operation: Effect.Effect<A, E>): A {
  const result = Effect.runSync(Effect.either(operation));
  assert.ok(Either.isRight(result));
  return result.right;
}

void test("v0.9 migration adds canonical defaults deterministically and preserves identities", () => {
  const current = document();
  const legacy = {
    schemaVersion: "0.9.0",
    id: current.id,
    title: current.title,
    description: null,
    objectives: current.objectives,
    cards: [{ id: cardId, front: "Q", back: "A", objectiveIds: [objectiveId] }],
  };
  const first = success(decodeAndMigrateKnowledgeArea(legacy));
  assert.deepEqual(first, success(decodeAndMigrateKnowledgeArea(legacy)));
  assert.equal(first.schemaVersion, "1.0.0");
  assert.equal(first.id, areaId);
  assert.equal(first.cards[0]?.id, cardId);
  assert.equal(first.cards[0].origin, "imported");
  assert.deepEqual(first.ai, {
    tutorInstructions: "",
    quizInstructions: null,
    cardGenerationInstructions: null,
  });
  assert.equal(first.language, "en");
});

void test("unknown versions and malformed JSON fail through typed channels", () => {
  fc.assert(
    fc.property(fc.integer({ min: 2, max: 1000 }), (version) => {
      const result = Effect.runSync(
        Effect.either(
          decodeAndMigrateKnowledgeArea({ ...document(), schemaVersion: `${String(version)}.0.0` }),
        ),
      );
      assert.ok(Either.isLeft(result));
      assert.equal(result.left.reason, "unsupported-version");
    }),
    { numRuns: 40, seed: 301 },
  );
  const malformed = Effect.runSync(Effect.either(parseKnowledgeAreaJson("{broken")));
  assert.ok(Either.isLeft(malformed));
  assert.equal(malformed.left.reason, "invalid-json");
});

void test("Basic content round trips while public exports omit private schedules and review state", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 120 }), fc.string({ maxLength: 120 }), (front, back) => {
      const original = document(`Question ${front}`, `Answer ${back}`);
      const imported = success(fromKnowledgeArea(original, "#112233", true, () => "unused", now));
      const privateArea = {
        ...imported,
        reviewEvents: [{ rating: "again", privateNote: "Keep private" }],
        observations: [{ feedback: "Private tutor feedback" }],
        schedulerSettings: { requestRetention: 0.91 },
        tutorTranscript: "Private conversation",
      };
      const exported = success(toKnowledgeArea(privateArea));
      assert.deepEqual(exported, original);
      for (const card of exported.cards) {
        assert.equal("schedule" in card, false);
        assert.equal("reviewEvents" in card, false);
      }
      assert.equal("reviewEvents" in exported, false);
      assert.equal("reviews" in exported, false);
      assert.equal("schedulerSettings" in exported, false);
      assert.equal("observations" in exported, false);
      assert.equal("tutorTranscript" in exported, false);
    }),
    { numRuns: 50, seed: 302 },
  );
});

void test("Basic and Cloze invalid content is rejected and valid Cloze renders selected deletion", () => {
  const empty = Effect.runSync(
    Effect.either(
      decodeAndMigrateKnowledgeArea({
        ...document(),
        cards: [{ ...document().cards[0], front: "" }],
      }),
    ),
  );
  assert.ok(Either.isLeft(empty));
  const cloze = {
    ...document(),
    cards: [
      {
        kind: "cloze",
        id: cardId,
        text: "ATP is {{c1::energy::hint}}.",
        deletionIndex: 1,
        objectiveIds: [objectiveId],
        tags: [],
        origin: "authored",
      },
    ],
  };
  const imported = success(
    fromKnowledgeArea(
      success(decodeAndMigrateKnowledgeArea(cloze)),
      "#112233",
      true,
      () => "unused",
      now,
    ),
  );
  assert.deepEqual(
    success(toKnowledgeArea(imported)).cards,
    success(decodeAndMigrateKnowledgeArea(cloze)).cards,
  );
  const rendered = success(renderCloze("ATP is {{c1::energy::hint}}.", 1));
  assert.match(rendered.back, /energy/);
  for (const invalid of [0, 2, -1, 1.5]) {
    assert.ok(
      Either.isLeft(Effect.runSync(Effect.either(renderCloze("ATP is {{c1::energy}}.", invalid)))),
    );
  }
});
